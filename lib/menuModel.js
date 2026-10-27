// Builds the menu as a plain tree, ported from Clipy's MenuManager. The shell layer renders it.

import {imageTitle, numberedTitle, previewText, rangeTitle, trimmedMenuTitle} from './titles.js';

/**
 * @typedef {object} MenuOptions
 * @property {number} inlineLimit history items shown before range submenus start
 * @property {number} folderLimit history items per range submenu
 * @property {number} maxTitleLength
 * @property {number} maxPreviewLines
 * @property {boolean} showTooltips
 * @property {boolean} markNumbers
 * @property {boolean} startAtZero
 * @property {boolean} snippetsAboveHistory
 * @property {boolean} showClearHistoryItem
 */

/**
 * @typedef {{type: 'label', text: string}
 *   | {type: 'separator'}
 *   | {type: 'history', id: string, number: number, title: string, tooltip: string | null, pinned: boolean,
 *      canMoveUp: boolean, canMoveDown: boolean,
 *      image: {hash: string, width: number, height: number} | null}
 *   | {type: 'snippet', id: string, title: string, tooltip: string | null}
 *   | {type: 'submenu', title: string, isFolder: boolean, children: MenuNode[]}
 *   | {type: 'action', action: 'clear-history' | 'edit-snippets' | 'settings', title: string}} MenuNode
 */

/**
 * @typedef {object} HistoryLists
 * @property {import('./historyStore.js').HistoryItem[]} pinned in pin order
 * @property {import('./historyStore.js').HistoryItem[]} recent unpinned items, newest first
 */

/**
 * @param {HistoryLists} history
 * @param {import('./snippetStore.js').SnippetFolder[]} folders
 * @param {MenuOptions} options
 * @returns {MenuNode[]}
 */
export function buildMainMenu(history, folders, options) {
    const nodes = [];
    const snippetNodes = buildSnippetNodes(folders, options);
    if (options.snippetsAboveHistory) {
        nodes.push(...snippetNodes, {type: 'separator'});
        nodes.push(...buildHistoryNodes(history, options));
    } else {
        nodes.push(...buildHistoryNodes(history, options));
        nodes.push({type: 'separator'}, ...snippetNodes);
    }
    nodes.push({type: 'separator'});
    if (options.showClearHistoryItem)
        nodes.push({type: 'action', action: 'clear-history', title: 'Clear History'});
    nodes.push({type: 'action', action: 'edit-snippets', title: 'Edit Snippets'});
    nodes.push({type: 'action', action: 'settings', title: 'Settings…'});
    return nodes;
}

/**
 * Pinned items, when there are any, come first in their own always-inline section.
 * Numbering runs continuously through pinned, inline and folder items, so every history
 * item has a unique number that a number key can select.
 *
 * @param {HistoryLists} lists
 * @param {MenuOptions} options
 * @returns {MenuNode[]}
 */
export function buildHistoryNodes({pinned, recent: history}, options) {
    let number = options.startAtZero ? 0 : 1;
    const nodes = [];
    if (pinned.length > 0) {
        nodes.push({type: 'label', text: 'Pinned'});
        pinned.forEach((item, index) => nodes.push({
            ...historyNode(item, number++, options),
            canMoveUp: index > 0,
            canMoveDown: index < pinned.length - 1,
        }));
    }
    nodes.push({type: 'label', text: 'History'});
    const inlineCount = Math.max(0, options.inlineLimit);
    const folderLimit = Math.max(1, options.folderLimit);

    history.slice(0, inlineCount).forEach(item => nodes.push(historyNode(item, number++, options)));
    for (let offset = inlineCount; offset < history.length; offset += folderLimit) {
        const chunk = history.slice(offset, offset + folderLimit);
        nodes.push({
            type: 'submenu',
            title: rangeTitle(number, number + chunk.length - 1),
            isFolder: true,
            children: chunk.map(item => historyNode(item, number++, options)),
        });
    }
    return nodes;
}

/**
 * @param {MenuNode[]} nodes
 * @returns {Map<number, string>} history item number to id, including items inside folders
 */
export function historyNumbers(nodes) {
    const numbers = new Map();
    const visit = list => list.forEach(node => {
        if (node.type === 'history')
            numbers.set(node.number, node.id);
        else if (node.type === 'submenu')
            visit(node.children);
    });
    visit(nodes);
    return numbers;
}

/**
 * @param {import('./snippetStore.js').SnippetFolder[]} folders
 * @param {MenuOptions} options
 * @returns {MenuNode[]}
 */
export function buildSnippetNodes(folders, options) {
    if (folders.length === 0)
        return [];

    const firstIndex = options.startAtZero ? 0 : 1;
    const nodes = [{type: 'label', text: 'Snippet'}];
    for (const folder of folders.filter(f => f.enabled)) {
        nodes.push({
            type: 'submenu',
            title: folder.title,
            isFolder: true,
            children: folder.snippets
                .filter(snippet => snippet.enabled)
                .map((snippet, index) => ({
                    type: 'snippet',
                    id: snippet.id,
                    title: numberedTitle(trimmedMenuTitle(snippet.title, options.maxTitleLength), firstIndex + index, options.markNumbers),
                    tooltip: tooltip(snippet.content, options),
                })),
        });
    }
    return nodes;
}

function historyNode(item, listNumber, options) {
    const isImage = item.kind === 'image';
    const title = isImage ? imageTitle(item.width, item.height) : trimmedMenuTitle(item.text, options.maxTitleLength);
    return {
        type: 'history',
        id: item.id,
        number: listNumber,
        title: numberedTitle(title, listNumber, options.markNumbers),
        tooltip: isImage ? null : tooltip(item.text, options),
        pinned: item.pinned === true,
        canMoveUp: false,
        canMoveDown: false,
        image: isImage ? {hash: item.hash, width: item.width, height: item.height} : null,
    };
}

function tooltip(text, options) {
    return options.showTooltips ? previewText(text, options.maxPreviewLines) : null;
}
