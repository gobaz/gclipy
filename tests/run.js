// Run with: gjs -m tests/run.js
import System from 'system';

import {runAll} from './harness.js';
import './historyStore.test.js';
import './menuModel.test.js';
import './misc.test.js';

System.exit(runAll() === 0 ? 0 : 1);
