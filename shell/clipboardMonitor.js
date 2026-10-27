// Watches the CLIPBOARD selection. Only code inside the shell can do this on Wayland.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {chooseClipContent} from '../lib/clipContent.js';

const CONCEALED_MIMETYPE = 'x-kde-passwordManagerHint';

/**
 * @typedef {object} ClipEvent
 * @property {'text' | 'image'} kind
 * @property {string} [text] text clips
 * @property {import('gi://GLib').default.Bytes} [bytes] image clips
 * @property {string} [mimetype] image clips
 * @property {boolean} concealed
 * @property {string | null} wmClass focused window when the clipboard changed
 * @property {string | null} appId
 */

export class ClipboardMonitor {
    /**
     * @param {object} params
     * @param {(clip: ClipEvent) => void} params.onClip
     * @param {() => boolean} params.recordImages checked on every change so the setting applies at once
     */
    constructor({onClip, recordImages}) {
        this._onClip = onClip;
        this._recordImages = recordImages;
        this._clipboard = St.Clipboard.get_default();
        this._ignoreCount = 0;
        this._destroyed = false;
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (_selection, selectionType) => {
            if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onOwnerChanged();
        });
    }

    /** Skip the next clipboard change, e.g. one gclipy makes itself before deleting the item. */
    ignoreNextChange() {
        this._ignoreCount++;
    }

    /** @param {string} text */
    setText(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    /** @param {import('gi://GLib').default.Bytes} bytes PNG data */
    setImage(bytes) {
        this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
    }

    _onOwnerChanged() {
        if (this._ignoreCount > 0) {
            this._ignoreCount--;
            return;
        }

        const mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        const content = chooseClipContent(mimetypes, this._recordImages());
        if (!content)
            return;

        // Read the focused window now: the async callbacks may run after focus moves.
        const window = global.display.focus_window;
        const source = {
            concealed: mimetypes.includes(CONCEALED_MIMETYPE),
            wmClass: window?.get_wm_class() ?? null,
            appId: window ? Shell.WindowTracker.get_default().get_window_app(window)?.get_id() ?? null : null,
        };

        if (content.kind === 'text') {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
                if (!this._destroyed && text)
                    this._onClip({kind: 'text', text, ...source});
            });
        } else {
            this._clipboard.get_content(St.ClipboardType.CLIPBOARD, content.mimetype, (_clipboard, bytes) => {
                if (this._destroyed || !(bytes?.get_size() > 0))
                    return;
                // The callback's bytes are only valid until it returns, and saving the image is async.
                const copy = new GLib.Bytes(bytes.toArray());
                this._onClip({kind: 'image', bytes: copy, mimetype: content.mimetype, ...source});
            });
        }
    }

    destroy() {
        this._destroyed = true;
        this._selection.disconnect(this._ownerChangedId);
    }
}
