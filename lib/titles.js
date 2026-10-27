// Menu title formatting, ported from Clipy's String.trimmedMenuTitle and MonospacedDigitFormatter.

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
 * @param {number} listNumber
 * @param {boolean} showsNumber
 * @returns {string}
 */
export function numberedTitle(title, listNumber, showsNumber) {
    return showsNumber ? `${listNumber}. ${title}` : title;
}

/**
 * @param {number} firstNumber
 * @param {number} lastNumber
 * @returns {string}
 */
export function rangeTitle(firstNumber, lastNumber) {
    return `${firstNumber} - ${lastNumber}`;
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
