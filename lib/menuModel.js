// Builds the menu as a plain tree, modelled on Clipy's MenuManager. The shell layer renders it.

import {folderTitle, imageTitle, numberedTitle, previewText, trimmedMenuTitle} from './titles.js';

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
 * @property {boolean} showIcons history items get a text or image icon, which replaces "(Image)"
 */

/**
 * @typedef {{type: 'label', text: string}
 *   | {type: 'separator'}
 *   | {type: 'history', id: string, number: number, title: string, tooltip: string | null, pinned: boolean,
 *      canMoveUp: boolean, canMoveDown: boolean,
 *      image: {hash: string, width: number, height: number} | null}
 *   | {type: 'snippet', id: string, title: string, tooltip: string | null}
 *   | {type: 'submenu', title: string, isFolder: boolean, children: MenuNode[], number?: number}
 *     (history folders have a number like the items beside them)
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
    const {pinnedNodes, recentNodes} = historySections(history, options);
    // Pinned items always come first; snippets go between them and History, or at the end.
    if (options.snippetsAboveHistory)
        nodes.push(...pinnedNodes, ...snippetNodes, {type: 'separator'}, ...recentNodes);
    else
        nodes.push(...pinnedNodes, ...recentNodes, {type: 'separator'}, ...snippetNodes);
    nodes.push({type: 'separator'});
    if (options.showClearHistoryItem)
        nodes.push({type: 'action', action: 'clear-history', title: 'Clear History'});
    nodes.push({type: 'action', action: 'edit-snippets', title: 'Edit Snippets'});
    nodes.push({type: 'action', action: 'settings', title: 'Settings…'});
    return nodes;
}

/**
 * Pinned items, when there are any, come first in their own always-inline section.
 * Numbering runs continuously through pinned items, inline items and folders, each folder
 * counting as one entry; inside a folder the items are numbered again from the start. A number
 * key picks an entry at the current level, so "8" then "1" pastes the first item of folder 8.
 *
 * @param {HistoryLists} lists
 * @param {MenuOptions} options
 * @returns {MenuNode[]}
 */
export function buildHistoryNodes(lists, options) {
    const {pinnedNodes, recentNodes} = historySections(lists, options);
    return [...pinnedNodes, ...recentNodes];
}

/**
 * The Pinned and History sections separately, so the main menu can put snippets between them.
 *
 * @param {HistoryLists} lists
 * @param {MenuOptions} options
 * @returns {{pinnedNodes: MenuNode[], recentNodes: MenuNode[]}}
 */
function historySections({pinned, recent: history}, options) {
    let number = options.startAtZero ? 0 : 1;
    const pinnedNodes = [];
    if (pinned.length > 0) {
        pinnedNodes.push({type: 'label', text: 'Pinned'});
        pinned.forEach((item, index) => pinnedNodes.push({
            ...historyNode(item, number++, options),
            canMoveUp: index > 0,
            canMoveDown: index < pinned.length - 1,
        }));
    }
    const recentNodes = [{type: 'label', text: 'History'}];
    const inlineCount = Math.max(0, options.inlineLimit);
    const folderLimit = Math.max(1, options.folderLimit);

    history.slice(0, inlineCount).forEach(item => recentNodes.push(historyNode(item, number++, options)));
    const firstInFolder = options.startAtZero ? 0 : 1;
    for (let offset = inlineCount; offset < history.length; offset += folderLimit) {
        const chunk = history.slice(offset, offset + folderLimit);
        recentNodes.push({
            type: 'submenu',
            number,
            title: numberedTitle(folderTitle(chunk.length), number++, options.markNumbers),
            isFolder: true,
            children: chunk.map((item, index) => historyNode(item, firstInFolder + index, options)),
        });
    }
    return {pinnedNodes, recentNodes};
}

/**
 * @typedef {Map<number, string | Map<number, string>>} HistoryNumbers
 *   number to item id, or for a history folder, to the numbers of the items inside it
 */

/**
 * @param {MenuNode[]} nodes
 * @returns {HistoryNumbers} in menu order
 */
export function historyNumbers(nodes) {
    const numbers = new Map();
    for (const node of nodes) {
        if (node.type === 'history')
            numbers.set(node.number, node.id);
        else if (node.type === 'submenu' && node.number !== undefined)
            numbers.set(node.number, new Map(node.children.map(child => [child.number, child.id])));
    }
    return numbers;
}

/**
 * @param {HistoryNumbers} numbers
 * @returns {string[]} item ids in menu order, folders' items included
 */
export function historyOrder(numbers) {
    return [...numbers.values()].flatMap(entry => typeof entry === 'string' ? [entry] : [...entry.values()]);
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
    const title = isImage
        ? imageTitle(item.width, item.height, !options.showIcons)
        : trimmedMenuTitle(item.text, options.maxTitleLength);
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
