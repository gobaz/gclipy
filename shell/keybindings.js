// Global shortcuts. Mutter re-reads the accelerators itself when the settings keys change.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Keybindings {
    /** @param {import('gi://Gio').default.Settings} settings */
    constructor(settings) {
        this._settings = settings;
        this._names = [];
    }

    /**
     * @param {string} name settings key holding the accelerators
     * @param {() => void} handler
     */
    add(name, handler) {
        Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, handler);
        this._names.push(name);
    }

    destroy() {
        for (const name of this._names)
            Main.wm.removeKeybinding(name);
        this._names = [];
    }
}
