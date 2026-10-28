// Menu title formatting, modelled on Clipy's String.trimmedMenuTitle and MonospacedDigitFormatter.

import {entryLabel} from './numberKeys.js';

const SHORTEN_SYMBOL = '...';

/**
 * Trim whitespace, keep only the first line and shorten it to maxLength characters.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function trimmedMenuTitle(text, maxLength) {
    const firstLine = text.trim().split(/\r\n|\r|\n/, 1)[0];
    // Count code points so emoji and other astral characters are not split in half.
    const chars = Array.from(firstLine);
    const limit = Math.max(maxLength, SHORTEN_SYMBOL.length);
    if (chars.length <= limit)
        return firstLine;
    return chars.slice(0, limit - SHORTEN_SYMBOL.length).join('') + SHORTEN_SYMBOL;
}

/**
 * @param {string} title
 * @param {number} listNumber shown as 1-9, 0, then A-Z (lib/numberKeys.js)
 * @param {boolean} showsNumber
 * @param {boolean} startAtZero
 * @returns {string}
 */
export function numberedTitle(title, listNumber, showsNumber, startAtZero = false) {
    return showsNumber ? `${entryLabel(listNumber, startAtZero)}. ${title}` : title;
}

/**
 * Title of a folder of older history items: their positions in the whole history, counting
 * pinned and inline items too, like Clipy's range titles.
 *
 * @param {number} first
 * @param {number} last
 * @returns {string}
 */
export function rangeTitle(first, last) {
    return `${first}-${last}`;
}

/**
 * Clipy titles images "(Image)". gclipy marks them with an icon when icons are shown, so the
 * word is only needed without them; the size helps tell screenshots apart.
 *
 * @param {number} width
 * @param {number} height
 * @param {boolean} withWord prefix "(Image)"
 * @returns {string}
 */
export function imageTitle(width, height, withWord) {
    return withWord ? `(Image) ${width}×${height}` : `${width}×${height}`;
}

// Very long single lines (minified code, base64) would wrap into a huge preview, so each
// line is also cut. Not a setting: the user-facing limit is the number of lines.
const MAX_PREVIEW_LINE_LENGTH = 300;
const ELLIPSIS = '…';

/**
 * The first maxLines lines of a text, ending in "…" when anything was cut.
 *
 * @param {string} text
 * @param {number} maxLines
 * @returns {string}
 */
export function previewText(text, maxLines) {
    const lines = text.split(/\r\n|\r|\n/);
    const shown = lines.slice(0, Math.max(1, maxLines)).map(line => {
        const chars = Array.from(line);
        return chars.length <= MAX_PREVIEW_LINE_LENGTH ? line
            : chars.slice(0, MAX_PREVIEW_LINE_LENGTH).join('') + ELLIPSIS;
    });
    if (lines.length > shown.length)
        shown.push(ELLIPSIS);
    return shown.join('\n');
}
