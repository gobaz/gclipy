// Smoke test that runs inside a headless GNOME Shell (see tests/smoke.sh) and drives gclipy.
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

const UUID = 'gclipy@gobaz.github.io';

// Disabling gclipy makes the shell disable and re-enable extensions loaded after it,
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
        check('gclipy is active', ext?.state === ExtensionState.ACTIVE, `state=${ext?.state} error=${ext?.error}`);
        let gclipy = ext.stateObj;
        const settings = gclipy.getSettings();

        check('example snippets seeded', gclipy._folders.length === 1 && gclipy._snippetsFile.exists());

        // Edit Snippets uses the plain-text editor; the lookup is stubbed so no app starts here.
        const getDefault = Gio.AppInfo.get_default_for_type;
        const launched = [];
        Gio.AppInfo.get_default_for_type = type => ({launch: files => launched.push(`${type} ${files[0].get_basename()}`)});
        try {
            gclipy._onAction('edit-snippets');
        } finally {
            Gio.AppInfo.get_default_for_type = getDefault;
        }
        check('Edit Snippets opens snippets.json in the text editor', launched.join() === 'text/plain snippets.json', launched.join());

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke one');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke two\nsecond line');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, '   ');
        await wait(300);
        const texts = gclipy._history.sorted(false).map(item => item.text);
        check('copies are recorded newest first, blank skipped', JSON.stringify(texts) === JSON.stringify(['smoke two\nsecond line', 'smoke one']), JSON.stringify(texts));

        const panelLabels = labels(gclipy._indicator.menu);
        check('indicator menu shows recent items inline by default', panelLabels.includes('1. smoke two') && panelLabels.includes('2. smoke one'), JSON.stringify(panelLabels));
        check('indicator menu shows actions', ['Clear History', 'Edit Snippets', 'Settings…'].every(l => panelLabels.includes(l)));

        settings.set_int('inline-limit', 0);
        await wait(100);
        const folderLabels = labels(gclipy._indicator.menu);
        check('inline-limit=0 re-renders with a range folder', folderLabels.includes('1 - 2') && !folderLabels.includes('1. smoke two'), JSON.stringify(folderLabels));
        settings.reset('inline-limit');

        gclipy._popUp('history');
        check('history popup opens at pointer', gclipy._pointerMenu.menu.isOpen);
        gclipy._pointerMenu.menu.close();

        gclipy._popUp('snippets');
        const snippetLabels = labels(gclipy._pointerMenu.menu);
        check('snippets popup lists folders', snippetLabels.includes('Examples'), JSON.stringify(snippetLabels));
        gclipy._pointerMenu.menu.close();

        // Pasting a snippet copies it but does not add it to history. The next test checks that
        // the following clipboard change is recorded again.
        const historyBefore = JSON.stringify(gclipy._history.sorted(false).map(item => item.text));
        gclipy._onSnippetSelected('0/0');
        await wait(300);
        check('pasting a snippet copies it', await clipboardText() === 'Hello!');
        check('pasting a snippet leaves history unchanged',
            JSON.stringify(gclipy._history.sorted(false).map(item => item.text)) === historyBefore, historyBefore);

        // Selecting the older item copies it back, which moves it to the top.
        const older = gclipy._history.sorted(false)[1];
        gclipy._onHistorySelected(older.id, new Set());
        await wait(300);
        check('selecting an item copies it', await clipboardText() === 'smoke one');
        check('selected item moves to the top', gclipy._history.sorted(false)[0].text === 'smoke one');

        // Selecting with the delete modifier held removes the item without copying it.
        settings.set_string('delete-modifier', 'shift');
        const deleteTarget = gclipy._history.sorted(false)[1];
        gclipy._onHistorySelected(deleteTarget.id, new Set(['shift']));
        await wait(300);
        settings.reset('delete-modifier');
        check('delete modifier removes the item', gclipy._history.size === 1 && !gclipy._history.get(deleteTarget.id));
        check('delete modifier does not copy', await clipboardText() === 'smoke one');

        settings.set_strv('excluded-apps', ['nothing-matches']);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke three');
        await wait(300);
        check('copies from other apps still recorded', gclipy._history.sorted(false)[0].text === 'smoke three');
        settings.reset('excluded-apps');

        // Paste-and-delete copies the item but must not record that copy again.
        settings.set_string('paste-delete-modifier', 'shift');
        const pasteDeleteTarget = gclipy._history.sorted(false)[1];
        gclipy._onHistorySelected(pasteDeleteTarget.id, new Set(['shift']));
        await wait(300);
        settings.reset('paste-delete-modifier');
        check('paste-delete copies the item', await clipboardText() === pasteDeleteTarget.text);
        check('paste-delete removes it from history', gclipy._history.size === 1 && !gclipy._history.get(pasteDeleteTarget.id));

        await wait(800);
        const saved = JSON.parse(new TextDecoder().decode(gclipy._historyFile.file.load_contents(null)[1]));
        check('history saved to disk', saved.items.length === 1, `${saved.items.length} items`);

        // The extension manager enables and disables extensions asynchronously.
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.INACTIVE);
        check('disable leaves no indicator', ext.state === ExtensionState.INACTIVE && !Main.panel.statusArea[UUID], `state=${ext.state}`);
        Main.extensionManager.enableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.ACTIVE);
        gclipy = ext.stateObj;
        check('re-enable reloads history', ext.state === ExtensionState.ACTIVE && gclipy._history?.size === 1, `size=${gclipy._history?.size}`);

        settings.set_boolean('show-indicator', false);
        check('show-indicator=false removes the icon', !Main.panel.statusArea[UUID]);
        settings.reset('show-indicator');
        check('show-indicator=true restores the icon', !!Main.panel.statusArea[UUID]);

        settings.set_boolean('confirm-clear-history', false);
        gclipy._onAction('clear-history');
        check('clear history empties it', gclipy._history.size === 0);
        settings.reset('confirm-clear-history');
        settings.reset('inline-limit');

        gclipy._popUp('history');
        check('empty history popup still opens', gclipy._pointerMenu.menu.isOpen,
            JSON.stringify(labels(gclipy._pointerMenu.menu)));
        gclipy._pointerMenu.menu.close();

        await this._testImages(gclipy, settings);
        gclipy = await this._testPins(gclipy, settings);
        await this._testNumberKeys(gclipy, settings);
        await this._testPreview(gclipy);
        gclipy = await this._testReorder(gclipy, settings);
        await this._testStartFocus(gclipy, settings);
        await this._testSideSubmenus(gclipy, settings);
        await this._testDeleteKey(gclipy, settings);

        gclipy.openPreferences();
        await wait(3000);
        // SMOKE_SCREENSHOT=path saves the screen with the prefs window for a visual check.
        const screenshotPath = GLib.getenv('SMOKE_SCREENSHOT');
        if (screenshotPath)
            await saveScreenshot(screenshotPath);
    }

    async _testPins(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const menu = () => gclipy._pointerMenu.menu;
        const itemFor = text => menu()._getMenuItems().find(item => item.label?.text.endsWith(text));
        const idOf = text => gclipy._history.sorted(false).find(item => item.text === text)?.id;

        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'pin me');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'other');
        await wait(300);

        // Click the pin button of "pin me" with a real (virtual) pointer.
        gclipy._popUp('history');
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
        check('pin button click pins the item', gclipy._history.get(idOf('pin me'))?.pinned === true);
        check('pin button click keeps the menu open', menu().isOpen);
        check('pin button click does not paste', await clipboardText() === 'other');
        const afterPin = labels(menu());
        check('pinned item moves to the Pinned section at once', JSON.stringify(afterPin.slice(0, 4)) ===
            JSON.stringify(['Pinned', '1. pin me', 'History', '2. other']), JSON.stringify(afterPin));
        check('focus follows the pinned item', global.stage.get_key_focus() === itemFor('pin me'));

        // Ctrl+P on the focused item (still "pin me") unpins it.
        const ctrlP = async () => {
            for (const [key, state] of [[Clutter.KEY_Control_L, Clutter.KeyState.PRESSED], [Clutter.KEY_p, Clutter.KeyState.PRESSED],
                [Clutter.KEY_p, Clutter.KeyState.RELEASED], [Clutter.KEY_Control_L, Clutter.KeyState.RELEASED]])
                keyboard.notify_keyval(time(), key, state);
            await wait(300);
        };
        await ctrlP();
        check('Ctrl+P toggles the pin', gclipy._history.get(idOf('pin me'))?.pinned === false);
        check('Ctrl+P keeps the menu open', menu().isOpen);
        const afterUnpin = labels(menu());
        check('unpinned item moves back to History at once', JSON.stringify(afterUnpin.slice(0, 3)) ===
            JSON.stringify(['History', '1. other', '2. pin me']), JSON.stringify(afterUnpin));
        check('focus follows the unpinned item', global.stage.get_key_focus() === itemFor('pin me'));
        menu().close();

        // With every history item in folders, unpinning opens the folder the item lands in.
        settings.set_int('inline-limit', 0);
        gclipy._popUp('history');
        await wait(300);
        const folder = menu()._getMenuItems().find(item => item.menu?.isOpen !== undefined && item.label?.text.startsWith('1 - '));
        folder.setSubmenuShown(true);
        await wait(300);
        folder.menu._getMenuItems().find(item => item.label?.text.endsWith('pin me')).grab_key_focus();
        await ctrlP();
        check('pinning from a folder moves the item out', gclipy._history.get(idOf('pin me'))?.pinned === true &&
            labels(menu()).slice(0, 2).join() === 'Pinned,1. pin me', JSON.stringify(labels(menu())));
        await ctrlP();
        const focused = global.stage.get_key_focus();
        const landingFolder = menu()._getMenuItems().find(item => item.menu?._getMenuItems?.().includes(focused));
        check('unpinning into a folder opens it and keeps focus', gclipy._history.get(idOf('pin me'))?.pinned === false &&
            focused?.label?.text.endsWith('pin me') && landingFolder?.isSubmenuOpen === true,
        `focused=${focused?.label?.text} folder=${landingFolder?.label?.text}`);
        menu().close();
        settings.reset('inline-limit');
        gclipy._history.setPinned(idOf('pin me'), false);

        // Pins survive clearing and the history limit.
        gclipy._history.setPinned(idOf('pin me'), true);
        gclipy._historyChanged();
        settings.set_boolean('confirm-clear-history', false);
        gclipy._onAction('clear-history');
        settings.reset('confirm-clear-history');
        check('pins survive Clear History', JSON.stringify(gclipy._history.sorted(false).map(item => item.text)) ===
            JSON.stringify(['pin me']));
        for (const text of ['x1', 'x2', 'x3']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }
        settings.set_int('max-history', 1);
        await wait(100);
        check('pins survive the history limit', JSON.stringify(gclipy._history.sorted(false).map(item => item.text)) ===
            JSON.stringify(['x3', 'pin me']));
        settings.reset('max-history');

        // A pinned image keeps its files through clearing and cleanup.
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(64, 64, 'png'));
        await waitFor(() => gclipy._history.sorted(false).some(item => item.width === 64));
        const image = gclipy._history.sorted(false).find(item => item.width === 64);
        gclipy._history.setPinned(image.id, true);
        gclipy._historyChanged();
        gclipy._clearHistory();
        await wait(2500);
        check('pinned image files survive cleanup', gclipy._images.imageFile(image.hash).query_exists(null) &&
            gclipy._images.thumbnailFile(image.hash).query_exists(null));

        // SMOKE_PIN_SCREENSHOT=path saves the menu with pinned items.
        gclipy._popUp('main');
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
        gclipy = ext.stateObj;
        check('pins persist across disable and enable', JSON.stringify(gclipy._history.pinned().map(item => item.text || item.kind)) ===
            JSON.stringify(['pin me', 'image']), JSON.stringify(gclipy._history.pinned()));

        pointer.run_dispose();
        keyboard.run_dispose();
        return gclipy;
    }

    async _testDeleteKey(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const menu = gclipy._pointerMenu.menu;
        const focused = () => global.stage.get_key_focus()?.label?.text;
        const itemFor = text => menu._getMenuItems().find(item => item.label?.text.endsWith(` ${text}`));
        const texts = () => gclipy._history.sorted(false).map(item => item.text).join(',');
        const press = async keyval => {
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
            await wait(300);
        };

        // Pins ra, rc, rb (1-3), then history d3, d2, d1 (4-6).
        settings.set_boolean('confirm-clear-history', false);
        gclipy._clearHistory();
        settings.reset('confirm-clear-history');
        for (const text of ['d1', 'd2', 'd3']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }

        gclipy._popUp('history');
        await wait(300);
        await press(Clutter.KEY_Delete);
        check('Delete removes the focused item and keeps the menu open',
            !gclipy._history.sorted(false).some(item => item.text === 'd3') && menu.isOpen, texts());
        check('focus moves to the next item', focused() === '4. d2', focused());
        check('Delete does not paste', await clipboardText() === 'd3');

        itemFor('d1').grab_key_focus();
        await press(Clutter.KEY_Delete);
        check('deleting the last item focuses the one above',
            !gclipy._history.sorted(false).some(item => item.text === 'd1') && focused() === '4. d2', `${focused()} ${texts()}`);

        itemFor('ra').grab_key_focus();
        await press(Clutter.KEY_Delete);
        check('Delete removes pinned items too', gclipy._history.pinned().map(item => item.text).join() === 'rc,rb' &&
            focused() === '1. rc', `${focused()} pins=${gclipy._history.pinned().map(item => item.text)}`);

        itemFor('d2').grab_key_focus();
        await press(Clutter.KEY_KP_Delete);
        check('keypad Delete works', !gclipy._history.sorted(false).some(item => item.text === 'd2') &&
            focused() === '2. rb', `${focused()} ${texts()}`);

        await press(Clutter.KEY_Delete);
        itemFor('rc').grab_key_focus();
        await press(Clutter.KEY_Delete);
        check('deleting everything leaves an open, empty menu', gclipy._history.size === 0 && menu.isOpen &&
            labels(menu).includes('No items'), JSON.stringify(labels(menu)));
        menu.close();
        keyboard.run_dispose();
    }

    async _testSideSubmenus(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const seat = Clutter.get_default_backend().get_default_seat();
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const time = () => GLib.get_monotonic_time();
        const menu = gclipy._pointerMenu.menu;
        const folder = title => menu._getMenuItems().find(item => item.label?.text === title);
        const focused = () => global.stage.get_key_focus();
        const tap = async keyval => {
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.RELEASED);
            await wait(200);
        };
        const pointAt = async (actor, wait_ms = 100) => {
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            pointer.notify_absolute_motion(time(), x + width / 2, y + height / 2);
            await wait(wait_ms);
        };
        const click = async actor => {
            await pointAt(actor);
            pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await wait(300);
        };
        const open = async () => {
            pointer.notify_absolute_motion(time(), 300, 120);
            await wait(100);
            gclipy._popUp('history');
            await wait(400);
        };

        // Pins ra, rc, rb (1-3); history t3, t2, t1, s2, s1 in folders of two: 4 - 5, 6 - 7, 8 - 8.
        for (const text of ['t1', 't2', 't3']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }
        settings.set_int('inline-limit', 0);
        settings.set_int('folder-limit', 2);

        await open();
        const first = folder('4 - 5');
        check('side submenu: focus starts on the first folder', focused() === first);
        await tap(Clutter.KEY_Right);
        const panel = first._panel;
        const [menuX] = menu.actor.get_transformed_position();
        const [menuWidth] = menu.actor.get_transformed_size();
        const [panelX] = panel.get_transformed_position();
        const [, headerY] = first.get_transformed_position();
        const [, childY] = first.menu._getMenuItems()[0].get_transformed_position();
        check('Right opens the folder beside the menu, focused on its first item',
            first.isSubmenuOpen && focused()?.label?.text === '4. t3' &&
            panelX >= menuX + menuWidth - 8 && Math.abs(childY - headerY) < 3,
        `focus=${focused()?.label?.text} panel x=${panelX} menu right=${menuX + menuWidth} child y=${childY} header y=${headerY}`);
        const [previewX] = gclipy._preview.actor.get_transformed_position();
        check('preview sits beside the side panel', gclipy._preview.actor.visible &&
            previewX >= panelX + panel.width, `preview x=${previewX} panel right=${panelX + panel.width}`);
        await tap(Clutter.KEY_Down);
        check('Down moves inside the side panel', focused()?.label?.text === '5. t2');
        await tap(Clutter.KEY_Down);
        check('Down at the end stays inside the side panel', panel.contains(focused()));
        await tap(Clutter.KEY_Left);
        check('Left closes the side panel and returns to the folder', !first.isSubmenuOpen && focused() === first);

        await tap(Clutter.KEY_Right);
        first.grab_key_focus();
        await tap(Clutter.KEY_Down);
        check('Down on an open folder moves to the next menu item and closes the panel',
            focused() === folder('6 - 7') && !first.isSubmenuOpen, focused()?.label?.text);
        await tap(Clutter.KEY_Return);
        check('Enter opens a folder', folder('6 - 7').isSubmenuOpen && focused()?.label?.text === '6. t1');
        await tap(Clutter.KEY_Return);
        check('Enter on an item inside pastes it and closes the menu', !menu.isOpen && await clipboardText() === 't1');

        // Mouse: hover opens, moving to another folder switches, clicking an item pastes.
        await open();
        const second = folder('8 - 8');
        await pointAt(folder('4 - 5'), 400);
        check('hovering a folder opens it', folder('4 - 5').isSubmenuOpen);
        await pointAt(folder('4 - 5').menu._getMenuItems()[1], 400);
        check('moving into the side panel keeps it open', folder('4 - 5').isSubmenuOpen);
        await pointAt(second, 500);
        check('hovering another folder switches to it', second.isSubmenuOpen && !folder('4 - 5').isSubmenuOpen);
        const screenshot = GLib.getenv('SMOKE_SUBMENU_SCREENSHOT');
        if (screenshot)
            await saveScreenshot(screenshot);
        await click(second.menu._getMenuItems()[0]);
        check('clicking an item in the side panel pastes it', !menu.isOpen && await clipboardText() === 's1');

        await open();
        await click(folder('4 - 5'));
        check('clicking a folder toggles it without closing the menu', menu.isOpen && folder('4 - 5').isSubmenuOpen);
        menu.close();
        await wait(200);
        check('closing the menu closes its side panel', !folder('4 - 5')?.isSubmenuOpen);

        settings.reset('inline-limit');
        settings.reset('folder-limit');
        keyboard.run_dispose();
        pointer.run_dispose();
    }

    async _testStartFocus(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const menu = gclipy._pointerMenu.menu;
        const focused = () => global.stage.get_key_focus()?.label?.text;
        const openAndRead = async kind => {
            gclipy._popUp(kind);
            await wait(200);
            const label = focused();
            menu.close();
            await wait(100);
            return label;
        };

        // Only pins so far (ra, rc, rb from the reorder test): nothing in History, so the first item.
        check('without history, focus starts on the first item', await openAndRead('history') === '1. ra');

        for (const text of ['s1', 's2']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }
        check('focus starts on the first History item, after the pins', await openAndRead('history') === '4. s2');

        settings.set_boolean('snippets-above-history', true);
        check('main menu skips snippets above history too', await openAndRead('main') === '4. s2');
        settings.reset('snippets-above-history');

        settings.set_int('inline-limit', 0);
        check('first History item in a folder: focus the folder', await openAndRead('history') === '4 - 5');
        settings.reset('inline-limit');

        check('snippets menu starts on its first item', await openAndRead('snippets') === 'Examples');

        // Park the pointer away from the top bar menu, where an earlier test left it; hovering an
        // item rightly takes the focus.
        const pointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 10, 700);
        await wait(100);
        pointer.run_dispose();
        const panelMenu = gclipy._indicator.menu;
        panelMenu.open();
        await wait(200);
        check('top bar menu also starts on the first History item', focused() === '4. s2', focused());
        panelMenu.close();
        await wait(100);
    }

    async _testReorder(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const seat = Clutter.get_default_backend().get_default_seat();
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const time = () => GLib.get_monotonic_time();
        const menu = () => gclipy._pointerMenu.menu;
        const itemFor = text => menu()._getMenuItems().find(item => item.label?.text.endsWith(` ${text}`));
        const order = () => gclipy._history.pinned().map(item => item.text).join(',');
        const focusedLabel = () => global.stage.get_key_focus()?.label?.text;
        const ctrl = async key => {
            keyboard.notify_keyval(time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time(), key, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time(), key, Clutter.KeyState.RELEASED);
            keyboard.notify_keyval(time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            await wait(300);
        };
        // Children of a pinned item: ornament, label, up, down, pin.
        const moveButtons = item => {
            const children = item.get_children();
            return {up: children[children.length - 3], down: children[children.length - 2]};
        };

        for (const item of gclipy._history.pinned())
            gclipy._history.setPinned(item.id, false);
        settings.set_boolean('confirm-clear-history', false);
        gclipy._clearHistory();
        settings.reset('confirm-clear-history');
        for (const text of ['ra', 'rb', 'rc']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
            gclipy._history.setPinned(gclipy._history.sorted(false)[0].id, true);
        }
        gclipy._historyChanged();

        gclipy._popUp('history');
        await wait(300);
        itemFor('ra').grab_key_focus();
        await ctrl(Clutter.KEY_Down);
        check('Ctrl+Down moves a pinned item down', order() === 'rb,ra,rc', order());
        check('Ctrl+Down keeps the menu open and focus on the item', menu().isOpen && focusedLabel() === '2. ra', focusedLabel());
        check('moving does not paste', await clipboardText() === 'rc');
        await ctrl(Clutter.KEY_Up);
        check('Ctrl+Up moves it back', order() === 'ra,rb,rc' && focusedLabel() === '1. ra', `${order()} focus=${focusedLabel()}`);
        const hasMoveButton = item => item.get_children().some(child => child.accessible_name === 'Move up');
        check('move buttons are hidden by default', !hasMoveButton(itemFor('ra')) && !hasMoveButton(itemFor('rb')));

        settings.set_boolean('show-move-buttons', true);
        menu().close();
        gclipy._popUp('history');
        await wait(300);
        check('show-move-buttons=true adds them', hasMoveButton(itemFor('rb')));

        check('first pin cannot move up, last cannot move down',
            !moveButtons(itemFor('ra')).up.reactive && moveButtons(itemFor('ra')).down.reactive &&
            moveButtons(itemFor('rc')).up.reactive && !moveButtons(itemFor('rc')).down.reactive);

        const up = moveButtons(itemFor('rc')).up;
        const [x, y] = up.get_transformed_position();
        const [width, height] = up.get_transformed_size();
        pointer.notify_absolute_motion(time(), x + width / 2, y + height / 2);
        await wait(100);
        pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(300);
        check('clicking ▲ moves the item up', order() === 'ra,rc,rb' && menu().isOpen, order());
        const reordered = labels(menu()).slice(0, 4);
        check('numbers follow the new order', JSON.stringify(reordered) === JSON.stringify(['Pinned', '1. ra', '2. rc', '3. rb']),
            JSON.stringify(reordered));
        menu().close();
        settings.reset('show-move-buttons');

        const ext = Main.extensionManager.lookup(UUID);
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.INACTIVE);
        Main.extensionManager.enableExtension(UUID);
        await waitFor(() => ext.state === ExtensionState.ACTIVE);
        gclipy = ext.stateObj;
        check('rearranged order persists', gclipy._history.pinned().map(item => item.text).join(',') === 'ra,rc,rb');

        keyboard.run_dispose();
        pointer.run_dispose();
        return gclipy;
    }

    async _testPreview(gclipy) {
        const clipboard = St.Clipboard.get_default();
        const preview = gclipy._preview.actor;
        const menu = gclipy._pointerMenu.menu;
        const itemFor = text => menu._getMenuItems().find(item => item.label?.text.endsWith(text));
        const pointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'preview one\npreview two');
        await wait(300);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'short');
        await wait(300);

        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 200, 150);
        await wait(100);
        gclipy._popUp('history');
        await wait(400);
        // An item is highlighted as the menu opens, before it has been laid out.
        const first = global.stage.get_key_focus();
        const [, firstY] = first.get_transformed_position();
        check('preview for the item focused on opening is placed', preview.visible &&
            Number.isFinite(preview.x) && Math.abs(preview.y - firstY) < 2, `preview ${preview.x},${preview.y} item y=${firstY}`);
        const [menuX, menuY] = menu.actor.get_transformed_position();
        const [menuWidth, menuHeight] = menu.actor.get_transformed_size();

        const multiLine = itemFor('preview one');
        multiLine.grab_key_focus();
        await wait(100);
        const [, itemY] = multiLine.get_transformed_position();
        check('preview shows the highlighted text', preview.visible && preview.child.text === 'preview one\npreview two');
        check('preview sits right of the menu, level with the item',
            preview.x >= menuX + menuWidth && Math.abs(preview.y - itemY) < 2,
            `menu x=${menuX}..${menuX + menuWidth} y=${menuY}, item y=${itemY}, preview ${preview.x},${preview.y}`);
        const screenshot = GLib.getenv('SMOKE_PREVIEW_SCREENSHOT');
        if (screenshot)
            await saveScreenshot(screenshot);

        itemFor('short').grab_key_focus();
        await wait(100);
        check('preview follows the highlight', preview.visible && preview.child.text === 'short');
        itemFor('(Image) 64×64').grab_key_focus();
        await wait(100);
        check('items without text hide the preview', !preview.visible);
        check('menu size never changes', JSON.stringify(menu.actor.get_transformed_size()) ===
            JSON.stringify([menuWidth, menuHeight]), `${menuHeight} -> ${menu.actor.get_transformed_size()[1]}`);
        menu.close();
        await wait(300);
        check('closing the menu hides the preview', !preview.visible);

        // Near the right edge the panel moves to the left of the menu.
        const monitor = Main.layoutManager.primaryMonitor;
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), monitor.x + monitor.width - 20, 150);
        await wait(100);
        gclipy._popUp('history');
        await wait(400);
        itemFor('preview one').grab_key_focus();
        await wait(100);
        const [edgeMenuX] = menu.actor.get_transformed_position();
        check('preview flips left at the screen edge', preview.visible && preview.x + preview.width <= edgeMenuX &&
            preview.x >= monitor.x, `menu x=${edgeMenuX}, preview x=${preview.x} w=${preview.width}`);
        menu.close();
        pointer.run_dispose();
    }

    async _testNumberKeys(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const time = () => GLib.get_monotonic_time();
        const tapKeyval = keyval => {
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time(), keyval, Clutter.KeyState.RELEASED);
        };
        const menu = gclipy._pointerMenu.menu;

        // Known state: pins "pin me" (1) and the 64x64 image (2) survive the clear; then n2 (3), n1 (4).
        settings.set_boolean('confirm-clear-history', false);
        gclipy._clearHistory();
        settings.reset('confirm-clear-history');
        for (const text of ['n1', 'n2']) {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(300);
        }

        gclipy._popUp('history');
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
        const onKey = gclipy._onMenuKey;
        gclipy._onMenuKey = (...args) => {
            keypadSeen.push(args[1].get_key_symbol());
            return onKey.apply(gclipy, args);
        };
        gclipy._popUp('main');
        const KEY_KP4_EVDEV = 75;
        keyboard.notify_key(time(), KEY_KP4_EVDEV, Clutter.KeyState.PRESSED);
        keyboard.notify_key(time(), KEY_KP4_EVDEV, Clutter.KeyState.RELEASED);
        await wait(400);
        gclipy._onMenuKey = onKey;
        numLock();
        check('keypad 4 pastes item 4 from the main menu', !menu.isOpen && await clipboardText() === 'n1',
            `keysyms seen: ${keypadSeen.map(k => k.toString(16))}, open=${menu.isOpen}`);
        menu.close();

        settings.set_boolean('number-keys', false);
        gclipy._popUp('history');
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
        const onMenuKey = gclipy._onMenuKey;
        gclipy._onMenuKey = (...args) => {
            seen.push(args[1].get_key_symbol());
            return onMenuKey.apply(gclipy, args);
        };
        gclipy._popUp('history');
        const KEY_1_EVDEV = 2;
        keyboard.notify_key(time(), KEY_1_EVDEV, Clutter.KeyState.PRESSED);
        keyboard.notify_key(time(), KEY_1_EVDEV, Clutter.KeyState.RELEASED);
        await wait(400);
        gclipy._onMenuKey = onMenuKey;
        check('Lithuanian layout: 1 key (types ą) pastes item 1',
            seen[0] === Clutter.KEY_aogonek && !menu.isOpen && await clipboardText() === 'pin me',
            `keysyms seen: ${seen.map(k => k.toString(16))}`);
        inputSources.reset('sources');
        await wait(500);

        keyboard.run_dispose();
    }

    async _testImages(gclipy, settings) {
        const clipboard = St.Clipboard.get_default();
        const firstImage = () => gclipy._history.sorted(false).find(item => item.kind === 'image');

        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(400, 100, 'png'));
        await waitFor(() => firstImage());
        const png = firstImage();
        check('copied PNG is recorded', png?.width === 400 && png?.height === 100, JSON.stringify(png));
        check('PNG and thumbnail files written', !!png &&
            gclipy._images.imageFile(png.hash).query_exists(null) &&
            gclipy._images.thumbnailFile(png.hash).query_exists(null));

        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/jpeg', makeImage(300, 150, 'jpeg'));
        await waitFor(() => firstImage()?.width === 300);
        const jpeg = firstImage();
        check('copied JPEG is stored as PNG', jpeg?.height === 150 &&
            gclipy._images.load(jpeg.hash).toArray()[1] === 80, JSON.stringify(jpeg));

        clipboard.set_text(St.ClipboardType.CLIPBOARD, 'smoke text after images');
        await wait(300);

        gclipy._popUp('history');
        await wait(300);
        const menuItems = gclipy._pointerMenu.menu._getMenuItems();
        const imageItems = menuItems.filter(item => item.label?.text.includes('(Image)'));
        check('menu lists images with titles', JSON.stringify(imageItems.map(item => item.label.text)) ===
            JSON.stringify(['2. (Image) 300×150', '3. (Image) 400×100']),
        JSON.stringify(menuItems.map(item => item.label?.text)));
        check('image items have thumbnails', imageItems.length === 2 && imageItems.every(hasThumbnail));
        // SMOKE_MENU_SCREENSHOT=path saves the open menu with thumbnails for a visual check.
        const menuScreenshot = GLib.getenv('SMOKE_MENU_SCREENSHOT');
        if (menuScreenshot)
            await saveScreenshot(menuScreenshot);
        gclipy._pointerMenu.menu.close();

        gclipy._onHistorySelected(png.id, new Set());
        await wait(300);
        const pasted = await clipboardContent('image/png');
        check('selecting an image puts the PNG on the clipboard',
            !!pasted && GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, pasted) === png.hash);
        check('selected image moves to the top without a duplicate',
            gclipy._history.sorted(false)[0].id === png.id &&
            gclipy._history.sorted(false).filter(item => item.kind === 'image').length === 2);

        settings.set_boolean('show-images', false);
        gclipy._popUp('history');
        const plainItems = gclipy._pointerMenu.menu._getMenuItems().filter(item => item.label?.text.includes('(Image)'));
        check('show-images=false hides thumbnails', plainItems.length === 2 && !plainItems.some(hasThumbnail));
        gclipy._pointerMenu.menu.close();
        settings.reset('show-images');

        settings.set_boolean('record-images', false);
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', makeImage(50, 50, 'png'));
        await wait(500);
        check('record-images=false skips images', !gclipy._history.sorted(false).some(item => item.width === 50));
        settings.reset('record-images');

        settings.set_string('delete-modifier', 'shift');
        gclipy._onHistorySelected(jpeg.id, new Set(['shift']));
        settings.reset('delete-modifier');
        const removed = await waitFor(() => !gclipy._images.imageFile(jpeg.hash).query_exists(null) &&
            !gclipy._images.thumbnailFile(jpeg.hash).query_exists(null));
        check('deleting an image removes its files', removed && gclipy._images.imageFile(png.hash).query_exists(null));

        gclipy._images.imageFile(png.hash).delete(null);
        gclipy._onHistorySelected(png.id, new Set());
        check('missing image file drops the entry', !gclipy._history.get(png.id));
    }
}
