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
     * @param {number} maxHistory
     * @param {boolean} sortByCreatedAt
     * @returns {boolean} whether anything was removed
     */
    trim(maxHistory, sortByCreatedAt) {
        const limit = Math.max(0, maxHistory);
        if (this._items.length <= limit)
            return false;
        const keep = new Set(this.sorted(sortByCreatedAt).slice(0, limit));
        this._items = this._items.filter(item => keep.has(item));
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

    /** @returns {boolean} */
    clear() {
        const hadItems = this._items.length > 0;
        this._items = [];
        return hadItems;
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
    // Files written before image support have no "kind"; those items are all text.
    return json.items.map(item => ({kind: 'text', ...item})).filter(isValidItem);
}

function isValidItem(item) {
    const validKind = item?.kind === 'text' ||
        (item?.kind === 'image' && Number.isFinite(item.width) && Number.isFinite(item.height));
    return validKind &&
        typeof item.id === 'string' &&
        typeof item.hash === 'string' &&
        typeof item.text === 'string' &&
        Number.isFinite(item.createdAt) &&
        Number.isFinite(item.updatedAt);
}
