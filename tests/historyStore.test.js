import {HistoryStore, itemsFromJSON, MAX_CLIP_LENGTH} from '../lib/historyStore.js';
import {assertEqual, test} from './harness.js';

function makeStore(items = []) {
    let clock = 100;
    let idCounter = 0;
    const store = new HistoryStore({
        items,
        hash: text => `h:${text}`,
        newId: () => `uuid${++idCounter}`,
        now: () => clock,
    });
    return {store, tick: (seconds = 1) => (clock += seconds)};
}

const DEFAULTS = {allowDuplicate: true, overwriteDuplicate: true, maxHistory: 30, sortByCreatedAt: false};
const texts = store => store.sorted(DEFAULTS.sortByCreatedAt).map(item => item.text);

test('history: skips blank text', () => {
    const {store} = makeStore();
    assertEqual(store.addText('  \n\t ', DEFAULTS), false);
    assertEqual(store.size, 0);
});

test('history: skips oversized clips', () => {
    const {store} = makeStore();
    assertEqual(store.addText('x'.repeat(MAX_CLIP_LENGTH + 1), DEFAULTS), false);
});

test('history: newest first', () => {
    const {store, tick} = makeStore();
    store.addText('a', DEFAULTS);
    tick();
    store.addText('b', DEFAULTS);
    assertEqual(texts(store), ['b', 'a']);
});

test('history: same-second adds keep insertion order', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    store.addText('b', DEFAULTS);
    assertEqual(texts(store), ['b', 'a']);
});

test('history: overwrite duplicate keeps createdAt and bumps updatedAt', () => {
    const {store, tick} = makeStore();
    store.addText('a', DEFAULTS);
    tick();
    store.addText('b', DEFAULTS);
    tick();
    store.addText('a', DEFAULTS);
    assertEqual(store.size, 2);
    const a = store.get('h:a');
    assertEqual([a.createdAt, a.updatedAt], [100, 102]);
    assertEqual(texts(store), ['a', 'b'], 'reorder by updatedAt');
    assertEqual(store.sorted(true).map(item => item.text), ['b', 'a'], 'createdAt order is unchanged');
});

test('history: re-copying within the same second still moves to the top', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    store.addText('b', DEFAULTS);
    store.addText('a', DEFAULTS);
    assertEqual(texts(store), ['a', 'b']);
});

test('history: duplicates rejected when not allowed', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    assertEqual(store.addText('a', {...DEFAULTS, allowDuplicate: false}), false);
    assertEqual(store.size, 1);
});

test('history: duplicates rejected when not allowed, without overwrite mode', () => {
    const {store} = makeStore();
    const options = {...DEFAULTS, allowDuplicate: false, overwriteDuplicate: false};
    store.addText('a', options);
    assertEqual(store.addText('a', options), false);
});

test('history: allowed duplicates without overwrite get new ids', () => {
    const {store} = makeStore();
    const options = {...DEFAULTS, overwriteDuplicate: false};
    store.addText('a', options);
    store.addText('a', options);
    assertEqual(store.sorted(false).map(item => item.id), ['uuid2', 'uuid1']);
});

test('history: trims oldest by updatedAt', () => {
    const {store, tick} = makeStore();
    for (const text of ['a', 'b', 'c']) {
        store.addText(text, {...DEFAULTS, maxHistory: 2});
        tick();
    }
    assertEqual(texts(store), ['c', 'b']);
});

test('history: trims by createdAt when not reordering', () => {
    const {store, tick} = makeStore();
    const options = {...DEFAULTS, sortByCreatedAt: true};
    store.addText('a', options);
    tick();
    store.addText('b', options);
    tick();
    store.addText('a', options); // bumps updatedAt only
    store.trim(1, true);
    assertEqual(store.sorted(true).map(item => item.text), ['b']);
});

test('history: delete and clear', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    store.addText('b', DEFAULTS);
    assertEqual(store.delete('h:a'), true);
    assertEqual(store.delete('missing'), false);
    assertEqual(texts(store), ['b']);
    assertEqual(store.clear(), true);
    assertEqual(store.clear(), false);
});

test('history: JSON round trip drops invalid items', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    const json = JSON.parse(JSON.stringify(store));
    json.items.push({id: 'broken'});
    const items = itemsFromJSON(json);
    assertEqual(items.map(item => item.text), ['a']);
    assertEqual(itemsFromJSON(null), []);
    assertEqual(itemsFromJSON({items: 'nope'}), []);
});

test('pins: pin order is stable and separate from recent', () => {
    const {store, tick} = makeStore();
    for (const text of ['a', 'b', 'c']) {
        store.addText(text, DEFAULTS);
        tick();
    }
    assertEqual(store.setPinned('h:b', true), true);
    assertEqual(store.setPinned('h:b', true), false, 'already pinned');
    assertEqual(store.setPinned('missing', true), false);
    store.setPinned('h:a', true);
    assertEqual(store.pinned().map(item => item.text), ['b', 'a'], 'earliest pin first');
    assertEqual(store.unpinned(false).map(item => item.text), ['c']);
    store.setPinned('h:b', false);
    store.setPinned('h:b', true);
    assertEqual(store.pinned().map(item => item.text), ['a', 'b'], 're-pinning goes last');
});

test('pins: excluded from max history', () => {
    const {store, tick} = makeStore();
    store.addText('pinned', DEFAULTS);
    store.setPinned('h:pinned', true);
    for (const text of ['a', 'b', 'c']) {
        tick();
        store.addText(text, {...DEFAULTS, maxHistory: 2});
    }
    assertEqual(store.pinned().map(item => item.text), ['pinned']);
    assertEqual(store.unpinned(false).map(item => item.text), ['c', 'b']);
    assertEqual(store.trim(0, false), true);
    assertEqual(store.size, 1, 'trim to zero keeps the pin');
});

test('pins: survive clear, not delete', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    store.addText('b', DEFAULTS);
    store.setPinned('h:a', true);
    assertEqual(store.clear(), true);
    assertEqual(store.sorted(false).map(item => item.text), ['a']);
    assertEqual(store.clear(), false, 'only pins left');
    assertEqual(store.delete('h:a'), true);
    assertEqual(store.size, 0);
});

test('pins: re-copying keeps the pin', () => {
    const {store, tick} = makeStore();
    store.addText('a', DEFAULTS);
    store.setPinned('h:a', true);
    tick();
    store.addText('a', DEFAULTS);
    assertEqual(store.get('h:a').pinned, true);
    assertEqual(store.size, 1);
});

test('pins: JSON round trip and old files', () => {
    const {store} = makeStore();
    store.addText('a', DEFAULTS);
    store.setPinned('h:a', true);
    const [item] = itemsFromJSON(JSON.parse(JSON.stringify(store)));
    assertEqual([item.pinned, item.pinOrder], [true, 1]);
    const [old] = itemsFromJSON({items: [{id: 'x', hash: 'h', text: 't', createdAt: 1, updatedAt: 1}]});
    assertEqual([old.pinned, old.pinOrder], [false, 0]);
});

test('pins: move up and down', () => {
    const {store} = makeStore();
    for (const text of ['a', 'b', 'c', 'free'])
        store.addText(text, DEFAULTS);
    for (const text of ['a', 'b', 'c'])
        store.setPinned(`h:${text}`, true);
    const order = () => store.pinned().map(item => item.text).join('');
    assertEqual(store.movePinned('h:a', 1), true);
    assertEqual(order(), 'bac');
    assertEqual(store.movePinned('h:c', -1), true);
    assertEqual(order(), 'bca');
    assertEqual(store.movePinned('h:b', -1), false, 'already first');
    assertEqual(store.movePinned('h:a', 1), false, 'already last');
    assertEqual(store.movePinned('h:free', -1), false, 'not pinned');
    assertEqual(store.movePinned('missing', 1), false);
    assertEqual(order(), 'bca');
    const reloaded = new HistoryStore({items: itemsFromJSON(JSON.parse(JSON.stringify(store))), hash: t => t, newId: () => 'x'});
    assertEqual(reloaded.pinned().map(item => item.text).join(''), 'bca', 'order is saved');
});

test('history: setText edits a text item in place', () => {
    const {store, tick} = makeStore();
    const options = {...DEFAULTS, overwriteDuplicate: false};
    store.addText('one', options);
    tick();
    store.addText('two', options);
    const [newest, oldest] = store.sorted(false);
    store.setPinned(oldest.id, true);
    assertEqual(store.setText(oldest.id, 'one edited'), true);
    const edited = store.get(oldest.id);
    assertEqual([edited.text, edited.hash, edited.pinned], ['one edited', 'h:one edited', true]);
    assertEqual(store.sorted(false)[0].id, newest.id, 'position unchanged');
    assertEqual(store.setText(oldest.id, 'one edited'), false, 'unchanged text');
    assertEqual(store.setText(oldest.id, '   '), false, 'blank text');
    assertEqual(store.setText('missing', 'x'), false, 'unknown id');
});

test('history: setText gives overwrite-mode items a fresh id', () => {
    const {store} = makeStore();
    store.addText('one', DEFAULTS);
    const [item] = store.sorted(false);
    assertEqual(item.id, 'h:one');
    store.setText(item.id, 'two');
    const [edited] = store.sorted(false);
    assertEqual(edited.text === 'two' && edited.id !== 'h:one', true);
    store.addText('one', DEFAULTS);
    assertEqual(new Set(store.sorted(false).map(i => i.id)).size, 2, 'ids stay unique');
});
