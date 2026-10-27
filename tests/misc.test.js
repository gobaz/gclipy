import GLib from 'gi://GLib';

import {historyAction, matchesApp} from '../lib/paste.js';
import {EXAMPLE_SNIPPETS, parseSnippets, SnippetParseError} from '../lib/snippetStore.js';
import {JsonFile} from '../lib/storage.js';
import {assertEqual, assertThrows, test} from './harness.js';

test('paste: modifier actions', () => {
    const action = (pressed, deleteModifier, pasteDeleteModifier) =>
        historyAction({pressed: new Set(pressed), deleteModifier, pasteDeleteModifier});
    assertEqual(action([], 'ctrl', 'shift'), 'paste');
    assertEqual(action(['ctrl'], 'ctrl', 'shift'), 'delete');
    assertEqual(action(['shift'], 'ctrl', 'shift'), 'paste-delete');
    assertEqual(action(['ctrl'], 'ctrl', 'ctrl'), 'paste-delete', 'paste-delete wins');
    assertEqual(action(['ctrl'], 'none', 'none'), 'paste');
});

test('paste: app matching', () => {
    assertEqual(matchesApp('Gnome-terminal', null, ['gnome-terminal']), true);
    assertEqual(matchesApp(null, null, ['gnome-terminal']), false);
    assertEqual(matchesApp('KeePassXC', null, [' keepassxc ']), true);
    assertEqual(matchesApp(null, 'org.keepassxc.KeePassXC.desktop', ['org.keepassxc.KeePassXC']), true);
    assertEqual(matchesApp('firefox', 'firefox.desktop', ['keepassxc']), false);
});

test('snippets: parse with defaults', () => {
    const folders = parseSnippets({folders: [{title: 'F', snippets: [{content: 'abc'}]}]});
    assertEqual(folders, [{id: '0', title: 'F', enabled: true, snippets: [{id: '0/0', title: 'abc', content: 'abc', enabled: true}]}]);
    assertEqual(parseSnippets(EXAMPLE_SNIPPETS).length, 1);
});

test('snippets: invalid files throw', () => {
    assertThrows(() => parseSnippets({}), SnippetParseError);
    assertThrows(() => parseSnippets({folders: [{}]}), SnippetParseError);
    assertThrows(() => parseSnippets({folders: [{title: 'F', snippets: [{title: 'x'}]}]}), SnippetParseError);
});

test('storage: save, load, missing and corrupt files', () => {
    const dir = GLib.dir_make_tmp('gclippy-test-XXXXXX');
    const file = new JsonFile(GLib.build_filenamev([dir, 'nested']), 'data.json');
    assertEqual(file.load(), undefined);
    file.saveNow({a: 1});
    assertEqual(file.load(), {a: 1});
    GLib.file_set_contents(file.path, '{broken');
    assertThrows(() => file.load(), SyntaxError);
    file.file.delete(null);
    removeTestDir(dir);
});

function removeTestDir(dir) {
    GLib.rmdir(GLib.build_filenamev([dir, 'nested']));
    GLib.rmdir(dir);
}
