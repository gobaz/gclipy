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
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength) {
    const chars = Array.from(text);
    return chars.length <= maxLength ? text : chars.slice(0, maxLength).join('');
}
