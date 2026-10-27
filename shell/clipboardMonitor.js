// Watches the CLIPBOARD selection. Only code inside the shell can do this on Wayland.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

const CONCEALED_MIMETYPE = 'x-kde-passwordManagerHint';

/**
 * @typedef {object} ClipEvent
 * @property {string} text
 * @property {boolean} concealed
 * @property {string | null} wmClass focused window when the clipboard changed
 * @property {string | null} appId
 */

export class ClipboardMonitor {
    /** @param {(clip: ClipEvent) => void} onClip */
    constructor(onClip) {
        this._onClip = onClip;
        this._clipboard = St.Clipboard.get_default();
        this._ignoreCount = 0;
        this._destroyed = false;
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (_selection, selectionType) => {
            if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onOwnerChanged();
        });
    }

    /** Skip the next clipboard change, e.g. one gclippy makes itself before deleting the item. */
    ignoreNextChange() {
        this._ignoreCount++;
    }

    /** @param {string} text */
    setText(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    _onOwnerChanged() {
        if (this._ignoreCount > 0) {
            this._ignoreCount--;
            return;
        }

        // Read the focused window now: the async text callback may run after focus moves.
        const window = global.display.focus_window;
        const wmClass = window?.get_wm_class() ?? null;
        const appId = window ? Shell.WindowTracker.get_default().get_window_app(window)?.get_id() ?? null : null;
        const mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        const concealed = mimetypes.includes(CONCEALED_MIMETYPE);

        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (this._destroyed || !text)
                return;
            this._onClip({text, concealed, wmClass, appId});
        });
    }

    destroy() {
        this._destroyed = true;
        this._selection.disconnect(this._ownerChangedId);
    }
}
