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
    assertEqual(store.add('  \n\t ', DEFAULTS), false);
    assertEqual(store.size, 0);
});

test('history: skips oversized clips', () => {
    const {store} = makeStore();
    assertEqual(store.add('x'.repeat(MAX_CLIP_LENGTH + 1), DEFAULTS), false);
});

test('history: newest first', () => {
    const {store, tick} = makeStore();
    store.add('a', DEFAULTS);
    tick();
    store.add('b', DEFAULTS);
    assertEqual(texts(store), ['b', 'a']);
});

test('history: same-second adds keep insertion order', () => {
    const {store} = makeStore();
    store.add('a', DEFAULTS);
    store.add('b', DEFAULTS);
    assertEqual(texts(store), ['b', 'a']);
});

test('history: overwrite duplicate keeps createdAt and bumps updatedAt', () => {
    const {store, tick} = makeStore();
    store.add('a', DEFAULTS);
    tick();
    store.add('b', DEFAULTS);
    tick();
    store.add('a', DEFAULTS);
    assertEqual(store.size, 2);
    const a = store.get('h:a');
    assertEqual([a.createdAt, a.updatedAt], [100, 102]);
    assertEqual(texts(store), ['a', 'b'], 'reorder by updatedAt');
    assertEqual(store.sorted(true).map(item => item.text), ['b', 'a'], 'createdAt order is unchanged');
});

test('history: duplicates rejected when not allowed', () => {
    const {store} = makeStore();
    store.add('a', DEFAULTS);
    assertEqual(store.add('a', {...DEFAULTS, allowDuplicate: false}), false);
    assertEqual(store.size, 1);
});

test('history: duplicates rejected when not allowed, without overwrite mode', () => {
    const {store} = makeStore();
    const options = {...DEFAULTS, allowDuplicate: false, overwriteDuplicate: false};
    store.add('a', options);
    assertEqual(store.add('a', options), false);
});

test('history: allowed duplicates without overwrite get new ids', () => {
    const {store} = makeStore();
    const options = {...DEFAULTS, overwriteDuplicate: false};
    store.add('a', options);
    store.add('a', options);
    assertEqual(store.sorted(false).map(item => item.id), ['uuid2', 'uuid1']);
});

test('history: trims oldest by updatedAt', () => {
    const {store, tick} = makeStore();
    for (const text of ['a', 'b', 'c']) {
        store.add(text, {...DEFAULTS, maxHistory: 2});
        tick();
    }
    assertEqual(texts(store), ['c', 'b']);
});

test('history: trims by createdAt when not reordering', () => {
    const {store, tick} = makeStore();
    const options = {...DEFAULTS, sortByCreatedAt: true};
    store.add('a', options);
    tick();
    store.add('b', options);
    tick();
    store.add('a', options); // bumps updatedAt only
    store.trim(1, true);
    assertEqual(store.sorted(true).map(item => item.text), ['b']);
});

test('history: delete and clear', () => {
    const {store} = makeStore();
    store.add('a', DEFAULTS);
    store.add('b', DEFAULTS);
    assertEqual(store.delete('h:a'), true);
    assertEqual(store.delete('missing'), false);
    assertEqual(texts(store), ['b']);
    assertEqual(store.clear(), true);
    assertEqual(store.clear(), false);
});

test('history: JSON round trip drops invalid items', () => {
    const {store} = makeStore();
    store.add('a', DEFAULTS);
    const json = JSON.parse(JSON.stringify(store));
    json.items.push({id: 'broken'});
    const items = itemsFromJSON(json);
    assertEqual(items.map(item => item.text), ['a']);
    assertEqual(itemsFromJSON(null), []);
    assertEqual(itemsFromJSON({items: 'nope'}), []);
});
