import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { installLibsignalBadMacLogDeduper } from '../lib/utils/libsignal-log-dedupe.js';
import { logReconnectDiagnostic } from '../lib/whatsapp/reconnect-logging.js';
import {
  createShutdownCleanup,
  installFatalProcessHandlers,
  installShutdownSignalHandlers,
} from '../lib/whatsapp/process-guards.js';

const FAILURE_HEADER = 'Failed to decrypt message with any known session...';
const BAD_MAC_SESSION_ERROR = 'Session error:Error: Bad MAC';
const BAD_MAC_STACK = [
  'Error: Bad MAC',
  '    at Object.verifyMAC (/workspace/nyaruka/node_modules/libsignal/src/crypto.js:87:19)',
  '    at SessionCipher.doDecryptWhisperMessage (/workspace/nyaruka/node_modules/libsignal/src/session_cipher.js:250:16)',
].join('\n');
const SUMMARY_MESSAGE = 'libsignal Bad MAC decrypt diagnostics suppressed';
const SUMMARY_INTERVAL_MS = 60_000;

function createHarness({ maxBufferedEntries, maxBufferedArgs, maxBufferedStringChars } = {}) {
  const printed = [];
  const logs = [];
  const immediates = [];
  const timers = [];
  let clockMs = 5_000;
  const consoleObject = {
    error(...args) {
      printed.push(args);
    },
  };
  const originalError = consoleObject.error;
  const logger = {
    info(details, message) { logs.push({ level: 'info', details, message }); },
    warn(details, message) { logs.push({ level: 'warn', details, message }); },
    error(details, message) { logs.push({ level: 'error', details, message }); },
    fatal(details, message) { logs.push({ level: 'fatal', details, message }); },
  };
  const dispose = installLibsignalBadMacLogDeduper({
    consoleObject,
    logger,
    summaryIntervalMs: SUMMARY_INTERVAL_MS,
    maxBufferedEntries,
    maxBufferedArgs,
    maxBufferedStringChars,
    nowFn: () => clockMs,
    setImmediateFn(callback) {
      immediates.push(callback);
      return callback;
    },
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cleared: false, fired: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
  });

  return {
    consoleObject,
    originalError,
    logs,
    printed,
    timers,
    logger,
    dispose,
    advanceTime(milliseconds) {
      clockMs += milliseconds;
    },
    flushImmediate() {
      while (immediates.length > 0) immediates.shift()();
    },
    fireNextTimer() {
      const timer = timers.find(candidate => !candidate.cleared && !candidate.fired);
      assert.ok(timer, 'expected a pending summary timer');
      timer.fired = true;
      timer.callback();
    },
  };
}

function emitBadMacBurst(consoleObject, count = 1) {
  for (let index = 0; index < count; index += 1) {
    consoleObject.error(FAILURE_HEADER);
    consoleObject.error(BAD_MAC_SESSION_ERROR, BAD_MAC_STACK);
  }
}

function emitBadMacDiagnostic(consoleObject, stackCount) {
  consoleObject.error(FAILURE_HEADER);
  for (let index = 0; index < stackCount; index += 1) {
    consoleObject.error(BAD_MAC_SESSION_ERROR, BAD_MAC_STACK);
  }
}

function fakeProcess() {
  const processObject = new EventEmitter();
  const exits = [];
  processObject.exit = code => exits.push(code);
  return { processObject, exits };
}

test('deduplicates exact Bad MAC bursts and reports count plus elapsed window without stacks', () => {
  const harness = createHarness();
  try {
    emitBadMacBurst(harness.consoleObject);
    harness.flushImmediate();
    assert.deepEqual(harness.logs, [], 'the summary should wait for the reporting window');
    assert.equal(harness.printed.length, 0);
    assert.equal(harness.timers[0].delay, SUMMARY_INTERVAL_MS);

    harness.advanceTime(12_500);
    emitBadMacBurst(harness.consoleObject, 2);
    harness.flushImmediate();
    assert.deepEqual(harness.logs, []);
    assert.deepEqual(harness.printed, []);

    harness.advanceTime(47_500);
    harness.fireNextTimer();
    assert.deepEqual(harness.logs, [{
      level: 'warn',
      details: { count: 3, elapsedMs: SUMMARY_INTERVAL_MS },
      message: SUMMARY_MESSAGE,
    }]);
    assert.doesNotMatch(JSON.stringify(harness.logs), /crypto\.js|session_cipher|Error: Bad MAC/i);
    assert.doesNotMatch(JSON.stringify(harness.logs), /logout|corrupt|reset|session/i);
  } finally {
    harness.dispose();
  }
});

test('fails open and forwards unrelated, partial, misshapen, or changed signatures unchanged', () => {
  const harness = createHarness();
  const expected = [];
  const sendUnmatched = (...calls) => {
    for (const args of calls) {
      harness.consoleObject.error(...args);
      expected.push(args);
    }
    harness.flushImmediate();
  };

  try {
    const unrelatedError = new Error('Invalid MAC length');
    sendUnmatched(['unrelated crypto failure', unrelatedError]);
    sendUnmatched([BAD_MAC_SESSION_ERROR, BAD_MAC_STACK]);

    const changedHeader = 'Failed to decrypt message with any known session…';
    sendUnmatched([changedHeader]);
    sendUnmatched([FAILURE_HEADER]);

    const changedCryptoLine = BAD_MAC_STACK.replace('crypto.js:87:', 'crypto.js:88:');
    sendUnmatched([FAILURE_HEADER], [BAD_MAC_SESSION_ERROR, changedCryptoLine]);

    const changedSessionFrame = BAD_MAC_STACK.replace('session_cipher.js:250:', 'session_cipher.js:251:');
    sendUnmatched([FAILURE_HEADER], [BAD_MAC_SESSION_ERROR, changedSessionFrame]);

    const partialStack = BAD_MAC_STACK.split('\n').slice(0, 2).join('\n');
    sendUnmatched([FAILURE_HEADER], [BAD_MAC_SESSION_ERROR, partialStack]);

    const changedErrorText = 'Session error:Error: MAC verification failed';
    sendUnmatched([FAILURE_HEADER], [changedErrorText, BAD_MAC_STACK]);

    const extraLibsignalFrame = `${BAD_MAC_STACK}\n    at changedFrame (/workspace/nyaruka/node_modules/libsignal/src/session_cipher.js:251:1)`;
    sendUnmatched([FAILURE_HEADER], [BAD_MAC_SESSION_ERROR, extraLibsignalFrame]);

    const trailingUnrelatedError = new Error('other synchronous console failure');
    sendUnmatched(
      [FAILURE_HEADER],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
      ['unrelated trailing error', trailingUnrelatedError],
    );

    harness.consoleObject.error('HTTP 401 diagnostic');
    expected.push(['HTTP 401 diagnostic']);
    harness.consoleObject.error('HTTP 408 diagnostic');
    expected.push(['HTTP 408 diagnostic']);

    assert.deepEqual(harness.printed, expected);
    assert.deepEqual(harness.logs, []);
  } finally {
    harness.dispose();
  }
});

test('forwards the full candidate batch when entry, argument, or stack-text caps are exceeded', () => {
  const entryHarness = createHarness({ maxBufferedEntries: 3 });
  try {
    emitBadMacDiagnostic(entryHarness.consoleObject, 4);
    entryHarness.flushImmediate();
    assert.deepEqual(entryHarness.printed, [
      [FAILURE_HEADER],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
    ]);
    assert.deepEqual(entryHarness.logs, []);
    assert.equal(entryHarness.timers.length, 0);
  } finally {
    entryHarness.dispose();
  }

  const argsHarness = createHarness({ maxBufferedArgs: 2 });
  try {
    emitBadMacBurst(argsHarness.consoleObject);
    argsHarness.flushImmediate();
    assert.deepEqual(argsHarness.printed, [
      [FAILURE_HEADER],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
    ]);
    assert.deepEqual(argsHarness.logs, []);
    assert.equal(argsHarness.timers.length, 0);
  } finally {
    argsHarness.dispose();
  }

  const stackHarness = createHarness({ maxBufferedStringChars: 100 });
  try {
    emitBadMacBurst(stackHarness.consoleObject);
    stackHarness.flushImmediate();
    assert.deepEqual(stackHarness.printed, [
      [FAILURE_HEADER],
      [BAD_MAC_SESSION_ERROR, BAD_MAC_STACK],
    ]);
    assert.deepEqual(stackHarness.logs, []);
    assert.equal(stackHarness.timers.length, 0);
  } finally {
    stackHarness.dispose();
  }
});

test('flushes the final count and elapsed window exactly once on normal signal shutdown', async () => {
  const harness = createHarness();
  const { processObject, exits } = fakeProcess();
  let closeCalls = 0;
  const cleanup = createShutdownCleanup({
    dispose: harness.dispose,
    close: async () => { closeCalls += 1; return true; },
  });
  const shutdownHandlers = installShutdownSignalHandlers({ processObject, logger: harness.logger, cleanup });

  try {
    emitBadMacBurst(harness.consoleObject);
    harness.flushImmediate();
    harness.advanceTime(7_250);

    await shutdownHandlers.handleSignal('SIGTERM');
    await shutdownHandlers.handleSignal('SIGINT');

    assert.deepEqual(harness.logs.filter(entry => entry.level === 'warn'), [{
      level: 'warn',
      details: { count: 1, elapsedMs: 7_250 },
      message: SUMMARY_MESSAGE,
    }]);
    assert.deepEqual(exits, [143]);
    assert.equal(closeCalls, 1);
    assert.equal(harness.consoleObject.error, harness.originalError);

    harness.consoleObject.error('normal shutdown passthrough');
    assert.deepEqual(harness.printed, [['normal shutdown passthrough']]);
  } finally {
    shutdownHandlers.dispose();
    harness.dispose();
  }
});

test('flushes the final count before fatal exit and keeps the fatal diagnostic visible', async () => {
  const harness = createHarness();
  const { processObject, exits } = fakeProcess();
  let closeCalls = 0;
  const cleanup = createShutdownCleanup({
    dispose: harness.dispose,
    close: async () => { closeCalls += 1; return true; },
  });
  const fatalHandlers = installFatalProcessHandlers({ processObject, logger: harness.logger, cleanup });

  try {
    emitBadMacBurst(harness.consoleObject);
    harness.flushImmediate();
    harness.advanceTime(2_500);

    const fatalError = new Error('synthetic fatal process diagnostic');
    await fatalHandlers.handleFatalError(fatalError, 'uncaughtException');
    await fatalHandlers.handleFatalError(fatalError, 'unhandledRejection');

    assert.deepEqual(harness.logs.map(({ level, message }) => ({ level, message })), [
      { level: 'fatal', message: 'Uncaught exception; shutting down after cleanup' },
      { level: 'warn', message: SUMMARY_MESSAGE },
    ]);
    assert.deepEqual(harness.logs[1], {
      level: 'warn',
      details: { count: 1, elapsedMs: 2_500 },
      message: SUMMARY_MESSAGE,
    });
    assert.deepEqual(exits, [1]);
    assert.equal(closeCalls, 1);
    assert.equal(harness.consoleObject.error, harness.originalError);

    harness.consoleObject.error('fatal passthrough');
    assert.deepEqual(harness.printed, [['fatal passthrough']]);
  } finally {
    fatalHandlers.dispose();
    harness.dispose();
  }
});

test('does not alter disconnect, 401, 408, or pairing diagnostics on the app logger', () => {
  const harness = createHarness();
  try {
    logReconnectDiagnostic(harness.logger, 'retry_scheduled', { reason: '408', statusCode: 408 });
    logReconnectDiagnostic(harness.logger, 'logout_confirmed', { statusCode: 401 });
    logReconnectDiagnostic(harness.logger, 'retry_scheduled', { reason: 'pairing' });
    harness.logger.info({ event: 'pairing_code_displayed' }, 'Pairing code displayed on attached terminal');

    assert.deepEqual(harness.logs.map(({ level, details, message }) => ({ level, details, message })), [
      {
        level: 'warn',
        details: { reason: '408', statusCode: 408 },
        message: '⚠️ Koneksi WhatsApp terputus. Nyaruka mencoba menyambung kembali; sesi tetap disimpan.',
      },
      {
        level: 'warn',
        details: { statusCode: 401 },
        message: '🔐 WhatsApp melaporkan sesi telah keluar. Pairing ulang diperlukan untuk menyambungkan kembali.',
      },
      {
        level: 'info',
        details: { reason: 'pairing' },
        message: 'Pairing reconnection scheduled',
      },
      {
        level: 'info',
        details: { event: 'pairing_code_displayed' },
        message: 'Pairing code displayed on attached terminal',
      },
    ]);
    assert.deepEqual(harness.printed, []);
  } finally {
    harness.dispose();
  }
});
