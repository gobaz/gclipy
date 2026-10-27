// Smoke test that runs inside a headless GNOME Shell (see tests/smoke.sh) and drives gclippy.
// Results are logged as "SMOKE ok|FAIL <name>" lines followed by "SMOKE DONE".

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'gclippy@gclippy.local';

// Disabling gclippy makes the shell disable and re-enable extensions loaded after it,
// including this one. The module stays loaded, so this flag keeps the test to one run.
let started = false;

const wait = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

async function waitFor(predicate, timeoutMs = 5000) {
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += 50) {
        if (predicate())
            return true;
        await wait(50);
    }
    return predicate();
}

const clipboardContent = mimetype => new Promise(resolve => {
    // Copy: the callback's bytes are freed when it returns.
    St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, mimetype,
        (_clipboard, bytes) => resolve(bytes ? new GLib.Bytes(bytes.toArray()) : null));
});

function makeImage(width, height, format) {
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, width, height);
    pixbuf.fill(format === 'png' ? 0xe95420ff : 0x2a7de1ff);
    const [, buffer] = pixbuf.save_to_bufferv(format, [], []);
    return new GLib.Bytes(buffer);
}

const clipboardText = () => new Promise(resolve => {
    St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text));
});

function check(name, condition, detail = '') {
    console.log(`SMOKE ${condition ? 'ok' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function saveScreenshot(path) {
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    return new Promise(resolve => {
        new Shell.Screenshot().screenshot(false, stream, (screenshot, result) => {
            screenshot.screenshot_finish(result);
            stream.close(null);
            resolve();
        });
    });
}

const hasThumbnail = item => item.get_children().some(child => child.style?.includes('background-image'));

const labels = menu => menu._getMenuItems()
    .filter(item => item.label && item.visible)
    .map(item => item.label.text);

export default class SmokeExtension extends Extension {
    enable() {
        if (started)
            return;
        started = true;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._timeoutId = 0;
            this._run()
                .catch(e => check('no exceptions', false, `${e}\n${e.stack}`))
                .finally(() => console.log('SMOKE DONE'));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
    }

    async _run() {
        let ext = Main.extensionManager.lookup(UUID);
        check('gclippy is active', ext?.state === ExtensionState.ACTIVE, `state=${ext?.state} error=${ext?.error}`);
        let gclippy = ext.stateObj;
        const settings = gclippy.getSettings();

        check('example snippets seeded', gclippy._folders.length === 1 && gclippy._snippetsFile.exists());

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke one');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke two\nsecond line');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, '   ');
        await wait(300);
        const texts = gclippy._history.sorted(false).map(item => item.text);
        check('copies are recorded newest first, blank skipped', JSON.stringify(texts) === JSON.stringify(['smoke two\nsecond line', 'smoke one']), JSON.stringify(texts));

        const panelLabels = labels(gclippy._indicator.menu);
        check('indicator menu shows recent items inline by default', panelLabels.includes('1. smoke two') && panelLabels.includes('2. smoke one'), JSON.stringify(panelLabels));
        check('indicator menu shows actions', ['Clear History', 'Edit Snippets', 'Settings…'].every(l => panelLabels.includes(l)));

        settings.set_int('inline-limit', 0);
        await wait(100);
        const folderLabels = labels(gclippy._indicator.menu);
        check('inline-limit=0 re-renders with a range folder', folderLabels.includes('1 - 2') && !folderLabels.includes('1. smoke two'), JSON.stringify(folderLabels));
        settings.reset('inline-limit');

        gclippy._popUp('history');
        check('history popup opens at pointer', gclippy._pointerMenu.menu.isOpen);
        gclippy._pointerMenu.menu.close();

        gclippy._popUp('snippets');
        const snippetLabels = labels(gclippy._pointerMenu.menu);
        check('snippets popup lists folders', snippetLabels.includes('Examples'), JSON.stringify(snippetLabels));
        gclippy._pointerMenu.menu.close();

        // Selecting the older item copies it back, which moves it to the top.
        const older = gclippy._history.sorted(false)[1];
        gclippy._onHistorySelected(older.id, new Set());
        await wait(300);
        check('selecting an item copies it', await clipboardText() === 'smoke one');
        check('selected item moves to the top', gclippy._history.sorted(false)[0].text === 'smoke one');

        // Selecting with the delete modifier held removes the item without copying it.
        settings.set_string('delete-modifier', 'shift');
        const deleteTarget = gclippy._history.sorted(false)[1];
        gclippy._onHistorySelected(deleteTarget.id, new Set(['shift']));
        await wait(300);
        settings.reset('delete-modifier');
        check('delete modifier removes the item', gclippy._history.size === 1 && !gclippy._history.get(deleteTarget.id));
        check('delete modifier does not copy', await clipboardText() === 'smoke one');

        settings.set_strv('excluded-apps', ['nothing-matches']);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke three');
        await wait(300);
        check('copies from other apps still recorded', gclippy._history.sorted(false)[0].text === 'smoke three');
        settings.reset('excluded-apps');

        // Paste-and-delete copies the item but must not record that copy again.
        settings.set_string('paste-delete-modifier', 'shift');
        const pasteDeleteTarget = gclippy._history.sorted(false)[1];
        gclippy._onHistorySelected(pasteDeleteTarget.id, new Set(['shift']));
        await wait(300);
        settings.reset('paste-delete-modifier');
        check('paste-delete copies the item', await clipboardText() === pasteDeleteTarget.text);
        check('paste-delete removes it from history', gclippy._history.size === 1 && !gclippy._history.get(pasteDeleteTarget.id));

        await wait(800);
        const saved = JSON.parse(new TextDecoder().decode(gclippy._historyFile.file.load_contents(null)[1]));
        check('history saved to disk', saved.items.length === 1, `${saved.items.length} items`);

        // The extension manager enables and disables extensions asynchronously.
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.INACTIVE);
        check('disable leaves no indicator', ext.state === ExtensionState.INACTIVE && !Main.panel.statusArea[UUID], `state=${ext.state}`);
        Main.extensionManager.enableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.ACTIVE);
        gclippy = ext.stateObj;
        check('re-enable reloads history', ext.state === ExtensionState.ACTIVE && gclippy._history?.size === 1, `size=${gclippy._history?.size}`);

        settings.set_boolean('show-indicator', false);
        check('show-indicator=false removes the icon', !Main.panel.statusArea[UUID]);
        settings.reset('show-indicator');
        check('show-indicator=true restores the icon', !!Main.panel.statusArea[UUID]);

        settings.set_boolean('confirm-clear-history', false);
        gclippy._onAction('clear-history');
        check('clear history empties it', gclippy._history.size === 0);
        settings.reset('confirm-clear-history');
        settings.reset('inline-limit');

        gclippy._popUp('history');
        check('empty history popup still opens', gclippy._pointerMenu.menu.isOpen,
            JSON.stringify(labels(gclippy._pointerMenu.menu)));
        gclippy._pointerMenu.menu.close();

        await this._testImages(gclippy, settings);
        gclippy = await this._testPins(gclippy, settings);
        await this._testNumberKeys(gclippy, settings);

        gclippy.openPreferences();
        await wait(3000);
        // SMOKE_SCREENSHOT=path saves the screen with the prefs window for a visual check.
        const screenshotPath = GLib.getenv('SMOKE_SCREENSHOT');
        if (screenshotPath)
            await saveScreenshot(screenshotPath);
    }

    async _testPins(gclippy, settings) {
        const clipboard = St.Clipboard.get_default();
        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const menu = () => gclippy._pointerMenu.menu;
        const itemFor = text => menu()._getMenuItems().find(item => item.label?.text.endsWith(text));
        const idOf = text => gclippy._history.sorted(false).find(item => item.text === text)?.id;

        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'pin me');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'other');
        await wait(300);

        // Click the pin button of "pin me" with a real (virtual) pointer.
        gclippy._popUp('history');
        await wait(300);
        const button = itemFor('pin me')?.get_last_child();
        const [x, y] = button.get_transformed_position();
        const [width, height] = button.get_transformed_size();
        const time = () => GLib.get_monotonic_time();
        pointer.notify_absolute_motion(time(), x + width / 2, y + height / 2);
        await wait(100);
        pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(300);
        check('pin button click pins the item', gclippy._history.get(idOf('pin me'))?.pinned === true);
        check('pin button click keeps the menu open', menu().isOpen);
        check('pin button click does not paste', await clipboardText() === 'other');
        menu().close();

        gclippy._popUp('history');
        const reopened = labels(menu());
        check('pinned section above history', JSON.stringify(reopened.slice(0, 4)) ===
            JSON.stringify(['Pinned', '1. pin me', 'History', '2. other']), JSON.stringify(reopened));

        // Ctrl+P on the focused item unpins it.
        itemFor('pin me').grab_key_focus();
        for (const [key, state] of [[Clutter.KEY_Control_L, Clutter.KeyState.PRESSED], [Clutter.KEY_p, Clutter.KeyState.PRESSED],
            [Clutter.KEY_p, Clutter.KeyState.RELEASED], [Clutter.KEY_Control_L, Clutter.KeyState.RELEASED]])
            keyboard.notify_keyval(time(), key, state);
        await wait(300);
        check('Ctrl+P toggles the pin', gclippy._history.get(idOf('pin me'))?.pinned === false);
        check('Ctrl+P keeps the menu open', menu().isOpen);
        menu().close();

        // Pins survive clearing and the history limit.
        gclippy._history.setPinned(idOf('pin me'), true);
        gclippy._historyChanged();
        settings.set_boolean('confirm-clear-history', false);
        gclippy._onAction('clear-history');
        settings.reset('confirm-clear-history');
        check('pins survive Clear History', JSON.stringify(gclippy._history.sorted(false).map(item => item.text)) ===
            JSON.stringify(['pin me']));
        for (const text of ['x1', 'x2', 'x3']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }
        settings.set_int('max-history', 1);
        await wait(100);
        check('pins survive the history limit', JSON.stringify(gclippy._history.sorted(false).map(item => item.text)) ===
            JSON.stringify(['x3', 'pin me']));
        settings.reset('max-history');

        // A pinned image keeps its files through clearing and cleanup.
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(64, 64, 'png'));
        await waitFor(() => gclippy._history.sorted(false).some(item => item.width === 64));
        const image = gclippy._history.sorted(false).find(item => item.width === 64);
        gclippy._history.setPinned(image.id, true);
        gclippy._historyChanged();
        gclippy._clearHistory();
        await wait(2500);
        check('pinned image files survive cleanup', gclippy._images.imageFile(image.hash).query_exists(null) &&
            gclippy._images.thumbnailFile(image.hash).query_exists(null));

        // SMOKE_PIN_SCREENSHOT=path saves the menu with pinned items.
        gclippy._popUp('main');
        await wait(300);
        const pinScreenshot = GLib.getenv('SMOKE_PIN_SCREENSHOT');
        if (pinScreenshot)
            await saveScreenshot(pinScreenshot);
        menu().close();

        const ext = Main.extensionManager.lookup(UUID);
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.INACTIVE);
        Main.extensionManager.enableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.ACTIVE);
        gclippy = ext.stateObj;
        check('pins persist across disable and enable', JSON.stringify(gclippy._history.pinned().map(item => item.text || item.kind)) ===
            JSON.stringify(['pin me', 'image']), JSON.stringify(gclippy._history.pinned()));

        pointer.run_dispose();
        keyboard.run_dispose();
        return gclippy;
    }

    async _testNumberKeys(gclippy, settings) {
        const clipboard = St.Clipboard.get_default();
        const keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const time = () => GLib.get_monotonic_time();
        const tapKeyval = keyval => {
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.RELEASED);
        };
        const menu = gclippy._pointerMenu.menu;

        // Known state: pins "pin me" (1) and the 64x64 image (2) survive the clear; then n2 (3), n1 (4).
        settings.set_boolean('confirm-clear-history', false);
        gclippy._clearHistory();
        settings.reset('confirm-clear-history');
        for (const text of ['n1', 'n2']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }

        gclippy._popUp('history');
        check('numbers continue from pinned items', JSON.stringify(labels(menu).slice(0, 6)) ===
            JSON.stringify(['Pinned', '1. pin me', '2. (Image) 64×64', 'History', '3. n2', '4. n1']), JSON.stringify(labels(menu)));
        tapKeyval(Clutter.KEY_3);
        await wait(400);
        check('pressing 3 pastes item 3 and closes the menu', !menu.isOpen && await clipboardText() === 'n2');

        // The keypad types digits only with NumLock on.
        const KEY_NUMLOCK_EVDEV = 69;
        const numLock = () => {
            keyboard.notify_key(time(), KEY_NUMLOCK_EVDEV, Clutter.KeyState.PRESSED);
            keyboard.notify_key(time(), KEY_NUMLOCK_EVDEV, Clutter.KeyState.RELEASED);
        };
        numLock();
        await wait(200);
        const keypadSeen = [];
        const onKey = gclippy._onMenuKey;
        gclippy._onMenuKey = (...args) => {
            keypadSeen.push(args[1].get_key_symbol());
            return onKey.apply(gclippy, args);
        };
        gclippy._popUp('main');
        const KEY_KP4_EVDEV = 75;
        keyboard.notify_key(time(), KEY_KP4_EVDEV, Clutter.KeyState.PRESSED);
        keyboard.notify_key(time(), KEY_KP4_EVDEV, Clutter.KeyState.RELEASED);
        await wait(400);
        gclippy._onMenuKey = onKey;
        numLock();
        check('keypad 4 pastes item 4 from the main menu', !menu.isOpen && await clipboardText() === 'n1',
            `keysyms seen: ${keypadSeen.map(k => k.toString(16))}, open=${menu.isOpen}`);
        menu.close();

        settings.set_boolean('number-keys', false);
        gclippy._popUp('history');
        tapKeyval(Clutter.KEY_3);
        await wait(400);
        check('number-keys=false leaves digits alone', menu.isOpen && await clipboardText() === 'n1');
        menu.close();
        settings.reset('number-keys');

        // Lithuanian layout: the 1 key types "ą", so the key's position must be used.
        const inputSources = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
        inputSources.set_value('sources', new GLib.Variant('a(ss)', [['xkb', 'lt']]));
        await wait(1000);
        const seen = [];
        const onMenuKey = gclippy._onMenuKey;
        gclippy._onMenuKey = (...args) => {
            seen.push(args[1].get_key_symbol());
            return onMenuKey.apply(gclippy, args);
        };
        gclippy._popUp('history');
        const KEY_1_EVDEV = 2;
        keyboard.notify_key(time(), KEY_1_EVDEV, Clutter.KeyState.PRESSED);
        keyboard.notify_key(time(), KEY_1_EVDEV, Clutter.KeyState.RELEASED);
        await wait(400);
        gclippy._onMenuKey = onMenuKey;
        check('Lithuanian layout: 1 key (types ą) pastes item 1',
            seen[0] === Clutter.KEY_aogonek && !menu.isOpen && await clipboardText() === 'pin me',
            `keysyms seen: ${seen.map(k => k.toString(16))}`);
        inputSources.reset('sources');
        await wait(500);

        keyboard.run_dispose();
    }

    async _testImages(gclippy, settings) {
        const clipboard = St.Clipboard.get_default();
        const firstImage = () => gclippy._history.sorted(false).find(item => item.kind === 'image');

        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(400, 100, 'png'));
        await waitFor(() => firstImage());
        const png = firstImage();
        check('copied PNG is recorded', png?.width === 400 && png?.height === 100, JSON.stringify(png));
        check('PNG and thumbnail files written', !!png &&
            gclippy._images.imageFile(png.hash).query_exists(null) &&
            gclippy._images.thumbnailFile(png.hash).query_exists(null));

        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/jpeg', makeImage(300, 150, 'jpeg'));
        await waitFor(() => firstImage()?.width === 300);
        const jpeg = firstImage();
        check('copied JPEG is stored as PNG', jpeg?.height === 150 &&
            gclippy._images.load(jpeg.hash).toArray()[1] === 80, JSON.stringify(jpeg));

        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke text after images');
        await wait(300);

        gclippy._popUp('history');
        await wait(300);
        const menuItems = gclippy._pointerMenu.menu._getMenuItems();
        const imageItems = menuItems.filter(item => item.label?.text.includes('(Image)'));
        check('menu lists images with titles', JSON.stringify(imageItems.map(item => item.label.text)) ===
            JSON.stringify(['2. (Image) 300×150', '3. (Image) 400×100']),
        JSON.stringify(menuItems.map(item => item.label?.text)));
        check('image items have thumbnails', imageItems.length === 2 && imageItems.every(hasThumbnail));
        // SMOKE_MENU_SCREENSHOT=path saves the open menu with thumbnails for a visual check.
        const menuScreenshot = GLib.getenv('SMOKE_MENU_SCREENSHOT');
        if (menuScreenshot)
            await saveScreenshot(menuScreenshot);
        gclippy._pointerMenu.menu.close();

        gclippy._onHistorySelected(png.id, new Set());
        await wait(300);
        const pasted = await clipboardContent('image/png');
        check('selecting an image puts the PNG on the clipboard',
            !!pasted && GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, pasted) === png.hash);
        check('selected image moves to the top without a duplicate',
            gclippy._history.sorted(false)[0].id === png.id &&
            gclippy._history.sorted(false).filter(item => item.kind === 'image').length === 2);

        settings.set_boolean('show-images', false);
        gclippy._popUp('history');
        const plainItems = gclippy._pointerMenu.menu._getMenuItems().filter(item => item.label?.text.includes('(Image)'));
        check('show-images=false hides thumbnails', plainItems.length === 2 && !plainItems.some(hasThumbnail));
        gclippy._pointerMenu.menu.close();
        settings.reset('show-images');

        settings.set_boolean('record-images', false);
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(50, 50, 'png'));
        await wait(500);
        check('record-images=false skips images', !gclippy._history.sorted(false).some(item => item.width === 50));
        settings.reset('record-images');

        settings.set_string('delete-modifier', 'shift');
        gclippy._onHistorySelected(jpeg.id, new Set(['shift']));
        settings.reset('delete-modifier');
        const removed = await waitFor(() => !gclippy._images.imageFile(jpeg.hash).query_exists(null) &&
            !gclippy._images.thumbnailFile(jpeg.hash).query_exists(null));
        check('deleting an image removes its files', removed && gclippy._images.imageFile(png.hash).query_exists(null));

        gclippy._images.imageFile(png.hash).delete(null);
        gclippy._onHistorySelected(png.id, new Set());
        check('missing image file drops the entry', !gclippy._history.get(png.id));
    }
}
