// Runs webmFix off the main thread (see recordingService.fixInWorker).
'use strict';

const { parentPort, workerData } = require('worker_threads');
const { fixWebmInPlace } = require('./webmFix');

try {
  parentPort.postMessage({ ok: true, result: fixWebmInPlace(workerData.filePath) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message });
}
