import {buildHistoryNodes, buildMainMenu, buildSnippetNodes, historyNumbers} from '../lib/menuModel.js';
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

test('menu: all history in range submenus by default', () => {
    assertEqual(shape(buildHistoryNodes(recent(history(12)), OPTIONS)), [
        'History',
        {'1 - 10': ['1. item 0', '2. item 1', '3. item 2', '4. item 3', '5. item 4',
            '6. item 5', '7. item 6', '8. item 7', '9. item 8', '10. item 9']},
        {'11 - 12': ['11. item 10', '12. item 11']},
    ]);
});

test('menu: inline items then ranges, starting at zero', () => {
    const nodes = buildHistoryNodes(recent(history(5)), {...OPTIONS, inlineLimit: 2, folderLimit: 2, startAtZero: true});
    assertEqual(shape(nodes), [
        'History',
        '0. item 0',
        '1. item 1',
        {'2 - 3': ['2. item 2', '3. item 3']},
        {'4 - 4': ['4. item 4']},
    ]);
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

test('menu: main menu order', () => {
    assertEqual(shape(buildMainMenu(recent([]), FOLDERS, OPTIONS)), [
        'History', 'separator', 'Snippet', {Work: ['1. Hi', '2. Bye']},
        'separator', 'Clear History', 'Edit Snippets', 'Settings…',
    ]);
    assertEqual(shape(buildMainMenu(recent([]), [], {...OPTIONS, snippetsAboveHistory: true, showClearHistoryItem: false})), [
        'separator', 'History', 'separator', 'Edit Snippets', 'Settings…',
    ]);
});

test('menu: numbering continues from pinned items into history and folders', () => {
    const pinned = [{id: 'p0', text: 'pin zero', pinned: true}, {id: 'p1', text: 'pin one', pinned: true}];
    const nodes = buildHistoryNodes({pinned, recent: history(3)}, {...OPTIONS, inlineLimit: 1, folderLimit: 5});
    assertEqual(shape(nodes), [
        'Pinned', '1. pin zero', '2. pin one',
        'History', '3. item 0', {'4 - 5': ['4. item 1', '5. item 2']},
    ]);
    assertEqual([...historyNumbers(nodes)], [[1, 'p0'], [2, 'p1'], [3, 'id0'], [4, 'id1'], [5, 'id2']]);
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
    assertEqual([...historyNumbers(nodes)], [[1, 'id0'], [2, 'id1']]);
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
