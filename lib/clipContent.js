// Decides what to record from the mimetypes the clipboard offers.

const TEXT_MIMETYPES = ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING', 'STRING', 'TEXT', 'COMPOUND_TEXT'];

// PNG first because it is lossless and what other apps most often accept; the rest get converted to PNG.
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/x-bmp', 'image/tiff', 'image/gif', 'image/webp'];

/**
 * Text wins when both are offered: spreadsheets and office apps put a rendered image
 * next to the text of a copied selection, and the text is what people want back.
 *
 * @param {string[]} mimetypes
 * @param {boolean} recordImages
 * @returns {{kind: 'text'} | {kind: 'image', mimetype: string} | null}
 */
export function chooseClipContent(mimetypes, recordImages) {
    if (mimetypes.some(type => TEXT_MIMETYPES.includes(type)))
        return {kind: 'text'};
    if (!recordImages)
        return null;
    const mimetype = IMAGE_MIMETYPES.find(type => mimetypes.includes(type));
    return mimetype ? {kind: 'image', mimetype} : null;
}
