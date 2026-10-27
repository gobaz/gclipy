// Image history files: <sha256>.png holds the copied image, <sha256>.thumb.png a small copy for the menu.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Thumbnails are rendered once at this bound and scaled down by the menu, so changing the
// thumbnail size setting does not require regenerating them.
export const THUMBNAIL_MAX = 512;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const FILE_PATTERN = /^([0-9a-f]{64})(\.thumb)?\.png$/;

/**
 * Read the dimensions from a PNG header without decoding the image.
 *
 * @param {Uint8Array} data
 * @returns {{width: number, height: number} | null}
 */
export function pngSize(data) {
    if (data.length < 24 || PNG_SIGNATURE.some((byte, i) => data[i] !== byte))
        return null;
    if (String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR')
        return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {width: view.getUint32(16), height: view.getUint32(20)};
}

/**
 * Scale a size down to fit within a box, keeping the aspect ratio. Never scales up.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} maxWidth
 * @param {number} [maxHeight] defaults to maxWidth
 * @returns {[number, number]}
 */
export function fitWithin(width, height, maxWidth, maxHeight = maxWidth) {
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export class ImageStore {
    /** @param {string} dir */
    constructor(dir) {
        this._dir = Gio.File.new_for_path(dir);
        // Hashes whose files are being written; garbage collection must not remove them yet.
        this._saving = new Set();
    }

    /** @param {string} hash */
    imageFile(hash) {
        return this._dir.get_child(`${hash}.png`);
    }

    /** @param {string} hash */
    thumbnailFile(hash) {
        return this._dir.get_child(`${hash}.thumb.png`);
    }

    /**
     * Store clipboard image data as PNG plus thumbnail.
     *
     * @param {GLib.Bytes} bytes
     * @param {string} mimetype
     * @param {Gio.Cancellable | null} cancellable
     * @returns {Promise<{hash: string, width: number, height: number}>}
     */
    async save(bytes, mimetype, cancellable) {
        const png = mimetype === 'image/png' ? bytes : encodePng(await decode(bytes, cancellable));
        const size = pngSize(png.toArray());
        if (!size)
            throw new Error(`Clipboard ${mimetype} data is not a readable image`);

        // Hash the stored PNG so pasting it back, which offers these exact bytes, matches the same entry.
        const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, png);
        this._saving.add(hash);
        try {
            GLib.mkdir_with_parents(this._dir.get_path(), 0o700);
            const image = this.imageFile(hash);
            if (!image.query_exists(null))
                await writeBytes(image, png, cancellable);
            const thumbnail = this.thumbnailFile(hash);
            if (!thumbnail.query_exists(null)) {
                const [width, height] = fitWithin(size.width, size.height, THUMBNAIL_MAX);
                await writeBytes(thumbnail, encodePng(await decode(png, cancellable, width, height)), cancellable);
            }
        } finally {
            this._saving.delete(hash);
        }
        return {hash, ...size};
    }

    /**
     * @param {string} hash
     * @returns {GLib.Bytes}
     */
    load(hash) {
        const [bytes] = this.imageFile(hash).load_bytes(null);
        return bytes;
    }

    /**
     * Delete image files that no history item refers to. Other files in the directory are left alone.
     *
     * @param {Set<string>} keep hashes still in history
     * @returns {number} files deleted
     */
    collectGarbage(keep) {
        if (!this._dir.query_exists(null))
            return 0;
        let deleted = 0;
        const children = this._dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = children.next_file(null); info; info = children.next_file(null)) {
            const hash = FILE_PATTERN.exec(info.get_name())?.[1];
            if (!hash || keep.has(hash) || this._saving.has(hash))
                continue;
            try {
                children.get_child(info).delete(null);
                deleted++;
            } catch (e) {
                logError(e, `gclippy: failed to delete ${info.get_name()}`);
            }
        }
        children.close(null);
        return deleted;
    }
}

/** Decode image data, optionally scaled to an exact size. */
function decode(bytes, cancellable, width, height) {
    const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
    return new Promise((resolve, reject) => {
        const callback = (_source, result) => {
            try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
            } catch (e) {
                reject(e);
            }
        };
        if (width)
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, width, height, false, cancellable, callback);
        else
            GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable, callback);
    });
}

/** @returns {GLib.Bytes} */
function encodePng(pixbuf) {
    const [, buffer] = pixbuf.save_to_bufferv('png', [], []);
    return new GLib.Bytes(buffer);
}

function writeBytes(file, bytes, cancellable) {
    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable,
            (_file, result) => {
                try {
                    file.replace_contents_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}
