// Fills gclippy with demo content inside a headless shell (tests/smoke.sh screenshot) and saves
// a cropped screenshot of the open menu to $SCREENSHOT_PATH. Used for the README image.

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'gclippy@gobaz.github.io';
const MARGIN = 24;

// The shell re-enables this helper when gclippy is toggled; the module flag keeps it to one run.
let started = false;

const wait = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

/** A generated gradient, so the README carries no third-party artwork. */
function demoImage(width, height) {
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            pixels[i] = 60 + Math.round(160 * x / width);
            pixels[i + 1] = 90 + Math.round(80 * y / height);
            pixels[i + 2] = 200 - Math.round(120 * x / width);
        }
    }
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels), GdkPixbuf.Colorspace.RGB,
        false, 8, width, height, width * 3);
    const [, buffer] = pixbuf.save_to_bufferv('png', [], []);
    return new GLib.Bytes(buffer);
}

function saveArea(path, [x, y, width, height]) {
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    return new Promise((resolve, reject) => {
        new Shell.Screenshot().screenshot_area(x, y, width, height, stream, (screenshot, result) => {
            try {
                screenshot.screenshot_area_finish(result);
                resolve();
            } catch (e) {
                reject(e);
            } finally {
                stream.close(null);
            }
        });
    });
}

/** Bounding box of the given actors plus a margin, clamped to the screen. */
function areaAround(actors) {
    const boxes = actors.filter(actor => actor.visible).map(actor => {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return [x, y, x + width, y + height];
    });
    const x1 = Math.max(0, Math.min(...boxes.map(b => b[0])) - MARGIN);
    const y1 = Math.max(0, Math.min(...boxes.map(b => b[1])) - MARGIN);
    const x2 = Math.min(global.stage.width, Math.max(...boxes.map(b => b[2])) + MARGIN);
    const y2 = Math.min(global.stage.height, Math.max(...boxes.map(b => b[3])) + MARGIN);
    return [x1, y1, x2 - x1, y2 - y1].map(Math.round);
}

export default class ScreenshotHelper extends Extension {
    enable() {
        if (started)
            return;
        started = true;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._timeoutId = 0;
            this._run()
                .catch(e => console.log(`SMOKE FAIL screenshot (${e}\n${e.stack})`))
                .finally(() => console.log('SMOKE DONE'));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
    }

    async _run() {
        const path = GLib.getenv('SCREENSHOT_PATH');
        if (!path)
            throw new Error('SCREENSHOT_PATH is not set');

        // A plain background (this shell's settings are isolated) and no overview.
        const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        background.set_string('picture-options', 'none');
        background.set_string('color-shading-type', 'solid');
        background.set_string('primary-color', '#2e3440');
        Main.overview.hide();

        const gclippy = Main.extensionManager.lookup(UUID).stateObj;
        const clipboard = St.Clipboard.get_default();
        const copy = async text => {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            await wait(250);
        };
        const pinNewest = () => {
            gclippy._history.setPinned(gclippy._history.unpinned(false)[0].id, true);
            gclippy._historyChanged();
        };

        await copy('https://github.com/gobaz/gclipy');
        pinNewest();
        await copy('git pull --rebase origin develop');
        pinNewest();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', demoImage(800, 450));
        await wait(1000);
        await copy('Meeting moved to 14:00, room 3B');
        await copy('make install && gnome-extensions enable gclippy@gobaz.github.io');
        await copy('function greet(name) {\n    return `Hello, ${name}!`;\n}');

        // The menu opens at the pointer.
        const pointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 60, 80);
        await wait(200);
        pointer.run_dispose();

        gclippy._popUp('main');
        await wait(800);
        await saveArea(path, areaAround([gclippy._pointerMenu.menu.actor, gclippy._preview.actor]));
        gclippy._pointerMenu.menu.close();
        console.log(`SMOKE ok screenshot saved to ${path}`);
    }
}
