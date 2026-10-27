// Clipboard history rules, ported from Clipy's ClipService.save and PasteboardHistoryRepository.

// Clips larger than this are skipped so a single huge copy cannot bloat history.json.
export const MAX_CLIP_LENGTH = 512 * 1024;

/**
 * @typedef {object} HistoryItem
 * @property {string} id
 * @property {'text' | 'image'} kind
 * @property {string} hash sha256 of the text, or of the stored PNG for images
 * @property {string} text empty for images
 * @property {number} [width] images only
 * @property {number} [height] images only
 * @property {number} createdAt unix seconds
 * @property {number} updatedAt unix seconds
 * @property {boolean} pinned pinned items are listed separately and survive trimming and clearing
 * @property {number} pinOrder position among pinned items, increasing with each pin
 */

/**
 * @typedef {object} AddOptions
 * @property {boolean} allowDuplicate keep a clip whose content is already in history
 * @property {boolean} overwriteDuplicate replace the existing entry instead of adding another one
 * @property {number} maxHistory
 * @property {boolean} sortByCreatedAt
 */

export class HistoryStore {
    /**
     * @param {object} params
     * @param {HistoryItem[]} [params.items]
     * @param {(text: string) => string} params.hash
     * @param {() => string} params.newId
     * @param {() => number} [params.now] unix seconds
     */
    constructor({items = [], hash, newId, now = () => Math.floor(Date.now() / 1000)}) {
        this._items = items.filter(isValidItem).map(item => ({...item}));
        this._hash = hash;
        this._newId = newId;
        this._now = now;
    }

    /**
     * @param {string} text
     * @param {AddOptions} options
     * @returns {boolean} whether history changed
     */
    addText(text, options) {
        // Don't save empty or whitespace-only text history
        if (text.trim() === '' || text.length > MAX_CLIP_LENGTH)
            return false;
        return this._add({kind: 'text', hash: this._hash(text), text}, options);
    }

    /**
     * @param {{hash: string, width: number, height: number}} image already stored by ImageStore
     * @param {AddOptions} options
     * @returns {boolean} whether history changed
     */
    addImage({hash, width, height}, options) {
        return this._add({kind: 'image', hash, text: '', width, height}, options);
    }

    _add(content, {allowDuplicate, overwriteDuplicate, maxHistory, sortByCreatedAt}) {
        // Clipy looks the duplicate up by hash id, which only finds entries saved in overwrite mode.
        // Matching on the hash field gives the intended behaviour in both modes.
        const existing = this._items.find(item => item.kind === content.kind && item.hash === content.hash);
        if (existing && !allowDuplicate)
            return false;

        const now = this._now();
        if (existing && overwriteDuplicate) {
            existing.updatedAt = now;
            // Timestamps have one-second resolution; moving the item last makes it win ties
            // with items copied in the same second.
            this._items = this._items.filter(item => item !== existing);
            this._items.push(existing);
        } else {
            this._items.push({
                id: overwriteDuplicate ? content.hash : this._newId(),
                ...content,
                createdAt: now,
                updatedAt: now,
                pinned: false,
                pinOrder: 0,
            });
        }
        this.trim(maxHistory, sortByCreatedAt);
        return true;
    }

    /** @returns {Set<string>} hashes of the images still in history */
    imageHashes() {
        return new Set(this._items.filter(item => item.kind === 'image').map(item => item.hash));
    }

    /**
     * @param {string} id
     * @param {boolean} pinned
     * @returns {boolean} whether anything changed
     */
    setPinned(id, pinned) {
        const item = this.get(id);
        if (!item || item.pinned === pinned)
            return false;
        item.pinned = pinned;
        // A counter rather than a timestamp, so pins made within the same second keep their order.
        item.pinOrder = pinned ? Math.max(0, ...this._items.map(i => i.pinOrder)) + 1 : 0;
        return true;
    }

    /** @returns {HistoryItem[]} pinned items, earliest pin first so their numbers stay put */
    pinned() {
        return this._items.filter(item => item.pinned).sort((a, b) => a.pinOrder - b.pinOrder);
    }

    /**
     * @param {boolean} sortByCreatedAt
     * @returns {HistoryItem[]} items that are not pinned, newest first
     */
    unpinned(sortByCreatedAt) {
        return this.sorted(sortByCreatedAt).filter(item => !item.pinned);
    }

    /**
     * @param {boolean} sortByCreatedAt
     * @returns {HistoryItem[]} newest first
     */
    sorted(sortByCreatedAt) {
        const key = sortByCreatedAt ? 'createdAt' : 'updatedAt';
        // Ties keep insertion order reversed so the most recently added item wins.
        return this._items
            .map((item, index) => ({item, index}))
            .sort((a, b) => b.item[key] - a.item[key] || b.index - a.index)
            .map(({item}) => item);
    }

    /**
     * Pinned items don't count toward the limit and are never removed here.
     *
     * @param {number} maxHistory
     * @param {boolean} sortByCreatedAt
     * @returns {boolean} whether anything was removed
     */
    trim(maxHistory, sortByCreatedAt) {
        const unpinned = this.unpinned(sortByCreatedAt);
        const limit = Math.max(0, maxHistory);
        if (unpinned.length <= limit)
            return false;
        const drop = new Set(unpinned.slice(limit));
        this._items = this._items.filter(item => !drop.has(item));
        return true;
    }

    /**
     * @param {string} id
     * @returns {HistoryItem | undefined}
     */
    get(id) {
        return this._items.find(item => item.id === id);
    }

    /**
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        const count = this._items.length;
        this._items = this._items.filter(item => item.id !== id);
        return this._items.length !== count;
    }

    /**
     * Remove everything except pinned items.
     *
     * @returns {boolean} whether anything was removed
     */
    clear() {
        const count = this._items.length;
        this._items = this._items.filter(item => item.pinned);
        return this._items.length !== count;
    }

    get size() {
        return this._items.length;
    }

    toJSON() {
        return {version: 1, items: this._items};
    }
}

/**
 * @param {unknown} json parsed history.json contents
 * @returns {HistoryItem[]}
 */
export function itemsFromJSON(json) {
    if (!Array.isArray(json?.items))
        return [];
    // Older files have no "kind" (all text) and no pin fields.
    return json.items.map(item => ({kind: 'text', pinned: false, pinOrder: 0, ...item})).filter(isValidItem);
}

function isValidItem(item) {
    const validKind = item?.kind === 'text' ||
        (item?.kind === 'image' && Number.isFinite(item.width) && Number.isFinite(item.height));
    return validKind &&
        typeof item.id === 'string' &&
        typeof item.hash === 'string' &&
        typeof item.text === 'string' &&
        Number.isFinite(item.createdAt) &&
        Number.isFinite(item.updatedAt) &&
        typeof item.pinned === 'boolean' &&
        Number.isFinite(item.pinOrder);
}
