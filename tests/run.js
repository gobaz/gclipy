// Run with: gjs -m tests/run.js
import GLib from 'gi://GLib';
import System from 'system';

import {runAll} from './harness.js';
import './historyStore.test.js';
import './images.test.js';
import './menuModel.test.js';
import './misc.test.js';

// Image tests use async GIO calls, which need a running main loop.
const loop = new GLib.MainLoop(null, false);
let exitCode = 1;
runAll().then(failed => {
    exitCode = failed === 0 ? 0 : 1;
}).finally(() => loop.quit());
loop.run();
System.exit(exitCode);
