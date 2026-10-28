import {buildHistoryNodes, buildMainMenu, buildSnippetNodes, historyNumbers, historyOrder} from '../lib/menuModel.js';
import {digitForKey, numberForDigit} from '../lib/numberKeys.js';
import {numberedTitle, previewText, trimmedMenuTitle} from '../lib/titles.js';
import {assertEqual, test} from './harness.js';

const OPTIONS = {
    inlineLimit: 0,
    folderLimit: 10,
    maxTitleLength: 20,
    maxPreviewLines: 8,
    showTooltips: true,
    markNumbers: true,
    startAtZero: false,
    snippetsAboveHistory: false,
    showClearHistoryItem: true,
};

const recent = items => ({pinned: [], recent: items});
const history = count => Array.from({length: count}, (_, i) => ({id: `id${i}`, text: `item ${i}`}));

const shape = nodes => nodes.map(node => {
    if (node.type === 'submenu')
        return {[node.title]: shape(node.children)};
    return node.title ?? node.text ?? node.type;
});

test('titles: trims to first line and shortens', () => {
    assertEqual(trimmedMenuTitle('  hello\nworld  ', 20), 'hello');
    assertEqual(trimmedMenuTitle('abcdefghij', 5), 'ab...');
    assertEqual(trimmedMenuTitle('abcde', 5), 'abcde');
    assertEqual(trimmedMenuTitle('abcdef', 1), '...', 'limit never goes below the symbol length');
    assertEqual(trimmedMenuTitle('😀😀😀😀😀😀', 5), '😀😀...', 'counts code points');
});

test('titles: numbering and truncation', () => {
    assertEqual(numberedTitle('x', 3, true), '3. x');
    assertEqual(numberedTitle('x', 3, false), 'x');
});

test('titles: preview counts lines', () => {
    assertEqual(previewText('one\ntwo\r\nthree', 2), 'one\ntwo\n…');
    assertEqual(previewText('one\ntwo', 2), 'one\ntwo', 'nothing cut, no ellipsis');
    assertEqual(previewText('a'.repeat(1000), 8), `${'a'.repeat(300)}…`, 'long lines are cut');
    assertEqual(previewText('one\ntwo', 0), 'one\n…', 'at least one line');
    assertEqual(previewText('x'.repeat(500), 8).length, 301, 'a 500-character line is not split into lines');
});

test('menu: all history in numbered folders by default, numbered from 1 inside', () => {
    assertEqual(shape(buildHistoryNodes(recent(history(12)), OPTIONS)), [
        'History',
        {'1. Older (10)': ['1. item 0', '2. item 1', '3. item 2', '4. item 3', '5. item 4',
            '6. item 5', '7. item 6', '8. item 7', '9. item 8', '10. item 9']},
        {'2. Older (2)': ['1. item 10', '2. item 11']},
    ]);
});

test('menu: inline items then folders, starting at zero', () => {
    const nodes = buildHistoryNodes(recent(history(5)), {...OPTIONS, inlineLimit: 2, folderLimit: 2, startAtZero: true});
    assertEqual(shape(nodes), [
        'History',
        '0. item 0',
        '1. item 1',
        {'2. Older (2)': ['0. item 2', '1. item 3']},
        {'3. Older (1)': ['0. item 4']},
    ]);
    const unnumbered = buildHistoryNodes(recent(history(3)), {...OPTIONS, inlineLimit: 1, markNumbers: false});
    assertEqual(shape(unnumbered), ['History', 'item 0', {'Older (2)': ['item 1', 'item 2']}]);
});

test('menu: inline limit larger than history', () => {
    assertEqual(shape(buildHistoryNodes(recent(history(2)), {...OPTIONS, inlineLimit: 5})), ['History', '1. item 0', '2. item 1']);
});

test('menu: empty history has only the label', () => {
    assertEqual(shape(buildHistoryNodes(recent([]), OPTIONS)), ['History']);
});

test('menu: tooltips follow settings', () => {
    const [, node] = buildHistoryNodes(recent([{id: 'a', text: 'l1\nl2\nl3'}]), {...OPTIONS, inlineLimit: 1, maxPreviewLines: 2});
    assertEqual(node.tooltip, 'l1\nl2\n…');
    const [, hidden] = buildHistoryNodes(recent([{id: 'a', text: 'abcdef'}]), {...OPTIONS, inlineLimit: 1, showTooltips: false});
    assertEqual(hidden.tooltip, null);
});

const FOLDERS = [
    {id: '0', title: 'Work', enabled: true, snippets: [
        {id: '0/0', title: 'Hi', content: 'Hello', enabled: true},
        {id: '0/1', title: 'Off', content: 'x', enabled: false},
        {id: '0/2', title: 'Bye', content: 'Goodbye', enabled: true},
    ]},
    {id: '1', title: 'Hidden', enabled: false, snippets: []},
];

test('menu: snippets skip disabled folders and snippets', () => {
    assertEqual(shape(buildSnippetNodes(FOLDERS, OPTIONS)), ['Snippet', {Work: ['1. Hi', '2. Bye']}]);
    assertEqual(buildSnippetNodes([], OPTIONS), []);
});

test('menu: main menu puts snippets between pinned items and history', () => {
    const pinned = [{id: 'p', text: 'pin', pinned: true}];
    const lists = {pinned, recent: history(1)};
    assertEqual(shape(buildMainMenu(lists, FOLDERS, {...OPTIONS, inlineLimit: 5, snippetsAboveHistory: true})), [
        'Pinned', '1. pin', 'Snippet', {Work: ['1. Hi', '2. Bye']}, 'separator', 'History', '2. item 0',
        'separator', 'Clear History', 'Edit Snippets', 'Settings…',
    ]);
    assertEqual(shape(buildMainMenu(lists, FOLDERS, {...OPTIONS, inlineLimit: 5, snippetsAboveHistory: false})), [
        'Pinned', '1. pin', 'History', '2. item 0', 'separator', 'Snippet', {Work: ['1. Hi', '2. Bye']},
        'separator', 'Clear History', 'Edit Snippets', 'Settings…',
    ]);
});

test('menu: main menu order', () => {
    assertEqual(shape(buildMainMenu(recent([]), FOLDERS, OPTIONS)), [
        'History', 'separator', 'Snippet', {Work: ['1. Hi', '2. Bye']},
        'separator', 'Clear History', 'Edit Snippets', 'Settings…',
    ]);
    assertEqual(shape(buildMainMenu(recent([]), [], {...OPTIONS, snippetsAboveHistory: true, showClearHistoryItem: false})), [
        'separator', 'History', 'separator', 'Edit Snippets', 'Settings…',
    ]);
});

test('menu: numbering continues from pinned items through history to folders', () => {
    const pinned = [{id: 'p0', text: 'pin zero', pinned: true}, {id: 'p1', text: 'pin one', pinned: true}];
    const nodes = buildHistoryNodes({pinned, recent: history(5)}, {...OPTIONS, inlineLimit: 1, folderLimit: 2});
    assertEqual(shape(nodes), [
        'Pinned', '1. pin zero', '2. pin one',
        'History', '3. item 0', {'4. Older (2)': ['1. item 1', '2. item 2']}, {'5. Older (2)': ['1. item 3', '2. item 4']},
    ]);
    const numbers = historyNumbers(nodes);
    assertEqual([...numbers.keys()], [1, 2, 3, 4, 5]);
    assertEqual([numbers.get(1), numbers.get(3)], ['p0', 'id0']);
    assertEqual([...numbers.get(4)], [[1, 'id1'], [2, 'id2']], 'a folder maps its own numbers');
    assertEqual([...numbers.get(5)], [[1, 'id3'], [2, 'id4']]);
    assertEqual(historyOrder(numbers), ['p0', 'p1', 'id0', 'id1', 'id2', 'id3', 'id4']);
    assertEqual(nodes.filter(node => node.type === 'history').map(node => node.pinned), [true, true, false]);
});

test('menu: pinned items stay inline even with inline limit 0', () => {
    const pinned = Array.from({length: 12}, (_, i) => ({id: `p${i}`, text: `p${i}`, pinned: true}));
    const nodes = buildHistoryNodes({pinned, recent: []}, OPTIONS);
    assertEqual(nodes.filter(node => node.type === 'history').length, 12);
    assertEqual(nodes.some(node => node.type === 'submenu'), false);
});

test('menu: numbers in the main menu ignore snippets', () => {
    const nodes = buildMainMenu({pinned: [], recent: history(2)}, FOLDERS, {...OPTIONS, inlineLimit: 1});
    assertEqual([...historyNumbers(nodes)].map(([number, entry]) => [number, typeof entry]), [[1, 'string'], [2, 'object']],
        'snippet folders get no number');
});

test('number keys: digits, keypad and number-row position', () => {
    assertEqual(digitForKey(0x31, 0), 1, '"1" keysym');
    assertEqual(digitForKey(0x30, 0), 0);
    assertEqual(digitForKey(0xffb7, 0), 7, 'keypad 7');
    assertEqual(digitForKey(0x1b1, 10), 1, 'Lithuanian ą on the 1 key');
    assertEqual(digitForKey(0x1b9, 18), 9);
    assertEqual(digitForKey(0xe0, 19), 0, 'French à on the 0 key');
    assertEqual(digitForKey(0x61, 38), null, 'letter a');
    assertEqual(numberForDigit(0, false), 10);
    assertEqual(numberForDigit(0, true), 0);
    assertEqual(numberForDigit(3, false), 3);
});

test('menu: pinned items know whether they can move', () => {
    const pinned = ['a', 'b', 'c'].map(id => ({id, text: id, pinned: true}));
    const nodes = buildHistoryNodes({pinned, recent: history(1)}, {...OPTIONS, inlineLimit: 5})
        .filter(node => node.type === 'history');
    assertEqual(nodes.map(node => [node.id, node.canMoveUp, node.canMoveDown]),
        [['a', false, true], ['b', true, true], ['c', true, false], ['id0', false, false]]);
});
