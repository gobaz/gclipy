// Sends the paste keystroke to the focused window through a virtual keyboard.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {matchesApp} from '../lib/paste.js';

// Lets the menu close and focus return to the target window before the keystroke is sent.
const PASTE_DELAY_MS = 100;

export class Paster {
    constructor() {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._timeoutId = 0;
    }

    /** @param {string[]} terminalClasses windows that need Ctrl+Shift+V */
    pasteSoon(terminalClasses) {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
            this._timeoutId = 0;
            this._paste(terminalClasses);
            return GLib.SOURCE_REMOVE;
        });
    }

    _paste(terminalClasses) {
        const window = global.display.focus_window;
        if (!window)
            return;
        const appId = Shell.WindowTracker.get_default().get_window_app(window)?.get_id() ?? null;
        const keys = matchesApp(window.get_wm_class(), appId, terminalClasses)
            ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
            : [Clutter.KEY_Control_L, Clutter.KEY_v];

        const time = GLib.get_monotonic_time();
        for (const key of keys)
            this._device.notify_keyval(time, key, Clutter.KeyState.PRESSED);
        for (const key of keys.reverse())
            this._device.notify_keyval(time, key, Clutter.KeyState.RELEASED);
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._device.run_dispose();
        this._device = null;
    }
}
