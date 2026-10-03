import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installLibsignalBadMacLogDeduper } from '../lib/utils/libsignal-log-dedupe.js';
import { logReconnectDiagnostic } from '../lib/whatsapp/reconnect-logging.js';

const FAILURE_HEADER = 'Failed to decrypt message with any known session...';
const BAD_MAC_SESSION_ERROR = 'Session error:Error: Bad MAC';
const BAD_MAC_STACK = [
  'Error: Bad MAC',
  '    at verifyMAC (/workspace/nyaruka/node_modules/libsignal/src/crypto.js:87:9)',
  '    at SessionCipher.doDecryptWhisperMessage (/workspace/nyaruka/node_modules/libsignal/src/session_cipher.js:42:3)',
].join('\n');
const SUMMARY_MESSAGE = 'Repeated libsignal Bad MAC decrypt diagnostics suppressed';

function createHarness() {
  const printed = [];
  const logs = [];
  const immediates = [];
  const timers = [];
  const consoleObject = {
    error(...args) {
      printed.push(args);
    },
  };
  const logger = {
    info(details, message) { logs.push({ level: 'info', details, message }); },
    warn(details, message) { logs.push({ level: 'warn', details, message }); },
    error(details, message) { logs.push({ level: 'error', details, message }); },
  };
  const dispose = installLibsignalBadMacLogDeduper({
    consoleObject,
    logger,
    summaryIntervalMs: 60_000,
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
    logs,
    printed,
    timers,
    logger,
    dispose,
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

test('deduplicates exact Bad MAC bursts and reports a sanitized count periodically', () => {
  const harness = createHarness();
  try {
    emitBadMacBurst(harness.consoleObject);
    assert.equal(harness.printed.length, 0);
    harness.flushImmediate();

    assert.equal(harness.printed.length, 0);
    assert.deepEqual(harness.logs, [{
      level: 'warn',
      details: { count: 1 },
      message: SUMMARY_MESSAGE,
    }]);

    emitBadMacBurst(harness.consoleObject, 2);
    harness.flushImmediate();
    assert.equal(harness.logs.length, 1, 'repeated failures should be rate-limited');

    harness.fireNextTimer();
    assert.deepEqual(harness.logs[1], {
      level: 'warn',
      details: { count: 2 },
      message: SUMMARY_MESSAGE,
    });
    const summaryDetails = harness.logs.map(({ details }) => details);
    assert.equal(JSON.stringify(summaryDetails).includes('Bad MAC'), false);
    assert.equal(JSON.stringify(summaryDetails).includes('session_cipher'), false);
  } finally {
    harness.dispose();
  }
});

test('replays unmatched crypto and ordinary console errors unchanged', () => {
  const harness = createHarness();
  try {
    const unrelatedError = new Error('Invalid MAC length');
    harness.consoleObject.error('unrelated crypto failure', unrelatedError);
    assert.deepEqual(harness.printed, [['unrelated crypto failure', unrelatedError]]);

    const mismatchedStack = BAD_MAC_STACK.replace('/crypto.js:', '/other.js:');
    harness.consoleObject.error(FAILURE_HEADER);
    harness.consoleObject.error(BAD_MAC_SESSION_ERROR, mismatchedStack);
    harness.flushImmediate();
    assert.deepEqual(harness.printed.slice(1), [
      [FAILURE_HEADER],
      [BAD_MAC_SESSION_ERROR, mismatchedStack],
    ]);

    const otherCryptoError = 'Session error:Error: Invalid MAC';
    harness.consoleObject.error(FAILURE_HEADER);
    harness.consoleObject.error(otherCryptoError, 'Error: Invalid MAC\n    at crypto.js:10:1');
    harness.flushImmediate();
    assert.deepEqual(harness.printed.slice(3), [
      [FAILURE_HEADER],
      [otherCryptoError, 'Error: Invalid MAC\n    at crypto.js:10:1'],
    ]);

    harness.consoleObject.error('HTTP 401 diagnostic');
    harness.consoleObject.error('HTTP 408 diagnostic');
    assert.deepEqual(harness.printed.slice(5), [['HTTP 401 diagnostic'], ['HTTP 408 diagnostic']]);
    assert.equal(harness.logs.length, 0);
  } finally {
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
