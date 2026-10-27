import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import {chooseClipContent} from '../lib/clipContent.js';
import {HistoryStore, itemsFromJSON} from '../lib/historyStore.js';
import {fitWithin, ImageStore, pngSize, THUMBNAIL_MAX} from '../lib/images.js';
import {buildHistoryNodes} from '../lib/menuModel.js';
import {assertEqual, assertRejects, test} from './harness.js';

function makeImage(width, height, format = 'png') {
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, width, height);
    pixbuf.fill(0x3366ccff);
    const [, buffer] = pixbuf.save_to_bufferv(format, [], []);
    return new GLib.Bytes(buffer);
}

function withTempDir(fn) {
    return async () => {
        const dir = GLib.dir_make_tmp('gclipy-images-XXXXXX');
        try {
            await fn(dir);
        } finally {
            GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir)}`);
        }
    };
}

function listDir(dir) {
    const names = [];
    const handle = GLib.Dir.open(dir, 0);
    for (let name = handle.read_name(); name; name = handle.read_name())
        names.push(name);
    handle.close();
    return names.sort();
}

test('clip content: text wins, images need the setting', () => {
    assertEqual(chooseClipContent(['image/png', 'text/plain;charset=utf-8'], true), {kind: 'text'});
    assertEqual(chooseClipContent(['UTF8_STRING'], false), {kind: 'text'});
    assertEqual(chooseClipContent(['image/jpeg', 'image/png'], true), {kind: 'image', mimetype: 'image/png'});
    assertEqual(chooseClipContent(['image/bmp'], true), {kind: 'image', mimetype: 'image/bmp'});
    assertEqual(chooseClipContent(['image/png'], false), null);
    assertEqual(chooseClipContent(['text/html', 'x-special/gnome-icon-list'], true), null);
});

test('images: png header and fitting', () => {
    assertEqual(pngSize(makeImage(300, 20).toArray()), {width: 300, height: 20});
    assertEqual(pngSize(makeImage(4, 4, 'jpeg').toArray()), null);
    assertEqual(pngSize(new Uint8Array(3)), null);
    assertEqual(fitWithin(2000, 1000, 512), [512, 256]);
    assertEqual(fitWithin(100, 3000, 512), [17, 512]);
    assertEqual(fitWithin(40, 20, 512), [40, 20], 'never upscales');
    assertEqual(fitWithin(5000, 1, 512), [512, 1], 'at least one pixel');
    assertEqual(fitWithin(1920, 1080, 100, 32), [57, 32], 'box limited by height');
    assertEqual(fitWithin(400, 100, 100, 32), [100, 25], 'box limited by width');
});

test('images: save writes PNG and thumbnail', withTempDir(async dir => {
    const store = new ImageStore(GLib.build_filenamev([dir, 'images']));
    const bytes = makeImage(1600, 400);
    const image = await store.save(bytes, 'image/png', null);
    assertEqual([image.width, image.height], [1600, 400]);
    assertEqual(image.hash, GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes));
    assertEqual(store.load(image.hash).compare(bytes), 0, 'original bytes kept');
    const thumbnail = GdkPixbuf.Pixbuf.new_from_file(store.thumbnailFile(image.hash).get_path());
    assertEqual([thumbnail.get_width(), thumbnail.get_height()], [THUMBNAIL_MAX, THUMBNAIL_MAX / 4]);
}));

test('images: other formats are stored as PNG with a stable hash', withTempDir(async dir => {
    const store = new ImageStore(dir);
    const jpeg = makeImage(64, 32, 'jpeg');
    const first = await store.save(jpeg, 'image/jpeg', null);
    const png = store.load(first.hash);
    assertEqual(pngSize(png.toArray()), {width: 64, height: 32});
    // Pasting the stored PNG back must map to the same history entry.
    const again = await store.save(png, 'image/png', null);
    assertEqual(again.hash, first.hash);
}));

test('images: unreadable data is rejected', withTempDir(async dir => {
    const store = new ImageStore(dir);
    await assertRejects(store.save(new GLib.Bytes(new Uint8Array([1, 2, 3])), 'image/png', null));
    await assertRejects(store.save(new GLib.Bytes(new Uint8Array([1, 2, 3])), 'image/jpeg', null));
}));

test('images: garbage collection keeps referenced and foreign files', withTempDir(async dir => {
    const store = new ImageStore(dir);
    const keep = await store.save(makeImage(10, 10), 'image/png', null);
    const drop = await store.save(makeImage(20, 10), 'image/png', null);
    GLib.file_set_contents(GLib.build_filenamev([dir, 'notes.txt']), 'not ours');
    assertEqual(store.collectGarbage(new Set([keep.hash])), 2);
    assertEqual(listDir(dir), [`${keep.hash}.png`, `${keep.hash}.thumb.png`, 'notes.txt'].sort());
    assertEqual(store.imageFile(drop.hash).query_exists(null), false);
}));

test('images: garbage collection spares images still being saved', withTempDir(async dir => {
    const store = new ImageStore(dir);
    const bytes = makeImage(4000, 3000);
    const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
    const saving = store.save(bytes, 'image/png', null);

    // Wait for the moment the full image is on disk but the thumbnail is still being made,
    // which is when history does not know the hash yet.
    let collectedMidSave = false;
    while (!store.thumbnailFile(hash).query_exists(null)) {
        if (store.imageFile(hash).query_exists(null)) {
            store.collectGarbage(new Set());
            collectedMidSave = true;
            break;
        }
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => resolve()));
    }
    await saving;
    assertEqual(collectedMidSave, true, 'test did not hit the window between the two writes');
    assertEqual(store.imageFile(hash).query_exists(null), true);
    assertEqual(store.thumbnailFile(hash).query_exists(null), true);
}));

test('history: image entries', () => {
    let clock = 1;
    const store = new HistoryStore({hash: t => `h:${t}`, newId: () => 'uuid', now: () => clock++});
    const options = {allowDuplicate: true, overwriteDuplicate: true, maxHistory: 30, sortByCreatedAt: false};
    store.addImage({hash: 'abc', width: 10, height: 20}, options);
    store.addText('abc', options);
    store.addImage({hash: 'abc', width: 10, height: 20}, options);
    assertEqual(store.sorted(false).map(item => `${item.kind}:${item.hash}`), ['image:abc', 'text:h:abc']);
    assertEqual([...store.imageHashes()], ['abc']);
    assertEqual(store.addImage({hash: 'abc', width: 10, height: 20}, {...options, allowDuplicate: false}), false);
});

test('history: JSON without kind loads as text, broken images dropped', () => {
    const base = {id: 'a', hash: 'h', text: 'x', createdAt: 1, updatedAt: 1};
    const items = itemsFromJSON({items: [
        base,
        {...base, id: 'b', kind: 'image', text: '', width: 3, height: 4},
        {...base, id: 'c', kind: 'image', text: ''},
        {...base, id: 'd', kind: 'video'},
    ]});
    assertEqual(items.map(item => `${item.id}:${item.kind}`), ['a:text', 'b:image']);
});

test('menu: image items', () => {
    const options = {inlineLimit: 5, folderLimit: 10, maxTitleLength: 5, maxPreviewLines: 8,
        showTooltips: true, markNumbers: true, startAtZero: false};
    const image = {id: 'i', kind: 'image', hash: 'abc', text: '', width: 1920, height: 1080, pinned: false};
    const [, node] = buildHistoryNodes({pinned: [], recent: [image]}, options);
    assertEqual(node, {type: 'history', id: 'i', number: 1, title: '1. (Image) 1920×1080', tooltip: null, pinned: false,
        canMoveUp: false, canMoveDown: false,
        image: {hash: 'abc', width: 1920, height: 1080}});
});
