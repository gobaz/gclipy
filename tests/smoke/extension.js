// Smoke test that runs inside a headless GNOME Shell (see tests/smoke.sh) and drives gclippy.
// Results are logged as "SMOKE ok|FAIL <name>" lines followed by "SMOKE DONE".

import Clutter from 'gi://Clutter';
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
        gclippy._onHistorySelected(older.id, null);
        await wait(300);
        check('selecting an item copies it', await clipboardText() === 'smoke one');
        check('selected item moves to the top', gclippy._history.sorted(false)[0].text === 'smoke one');

        // Selecting with the delete modifier held removes the item without copying it.
        settings.set_string('delete-modifier', 'shift');
        const shiftEvent = {get_state: () => Clutter.ModifierType.SHIFT_MASK};
        const deleteTarget = gclippy._history.sorted(false)[1];
        gclippy._onHistorySelected(deleteTarget.id, shiftEvent);
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
        gclippy._onHistorySelected(pasteDeleteTarget.id, shiftEvent);
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

        gclippy.openPreferences();
        await wait(3000);
        // SMOKE_SCREENSHOT=path saves the screen with the prefs window for a visual check.
        const screenshotPath = GLib.getenv('SMOKE_SCREENSHOT');
        if (screenshotPath)
            await saveScreenshot(screenshotPath);
    }
}
