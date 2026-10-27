// JSON files in ~/.local/share/gclippy. Writes replace the file atomically.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SAVE_DELAY_MS = 500;

export function defaultDataDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'gclippy']);
}

export class JsonFile {
    /**
     * @param {string} dir
     * @param {string} name
     */
    constructor(dir, name) {
        this._dir = dir;
        this.path = GLib.build_filenamev([dir, name]);
        this.file = Gio.File.new_for_path(this.path);
        this._saveSourceId = 0;
        this._pending = null;
    }

    exists() {
        return this.file.query_exists(null);
    }

    /**
     * @returns {unknown} parsed JSON, or undefined when the file does not exist
     * @throws {SyntaxError} when the file is not valid JSON
     */
    load() {
        if (!this.exists())
            return undefined;
        const [, contents] = this.file.load_contents(null);
        return JSON.parse(new TextDecoder().decode(contents));
    }

    /** @param {unknown} value */
    saveNow(value) {
        this.cancelPendingSave();
        GLib.mkdir_with_parents(this._dir, 0o700);
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
        this.file.replace_contents(bytes, null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    /**
     * Coalesce frequent changes, such as fast repeated copies, into one write.
     *
     * @param {() => unknown} serialize called when the write happens
     */
    saveLater(serialize) {
        this._pending = serialize;
        if (this._saveSourceId)
            return;
        this._saveSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveSourceId = 0;
            const pending = this._pending;
            this._pending = null;
            try {
                this.saveNow(pending());
            } catch (e) {
                logError(e, `gclippy: failed to save ${this.path}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Write any pending change immediately, e.g. when the extension is disabled. */
    flush() {
        const pending = this._pending;
        this.cancelPendingSave();
        if (pending)
            this.saveNow(pending());
    }

    cancelPendingSave() {
        if (this._saveSourceId) {
            GLib.source_remove(this._saveSourceId);
            this._saveSourceId = 0;
        }
        this._pending = null;
    }
}
