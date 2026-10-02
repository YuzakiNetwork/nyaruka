import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, test } from 'node:test';

import { createLogger } from '../lib/utils/logger.js';
import { writePairingCodeToTerminal } from '../lib/whatsapp/pairing-output.js';
import { logReconnectDiagnostic } from '../lib/whatsapp/reconnect-logging.js';
import {
  calculateRetryDelay,
  classifyDisconnect,
  createCredentialPersister,
  createQueuedKeyStore,
  createReconnectController,
  quarantineSession,
  retryFailedCredentialSave,
} from '../lib/whatsapp/reliability.js';

const tempRoots = new Set();

after(() => {
  for (const directory of tempRoots) fs.rmSync(directory, { recursive: true, force: true });
});

function makeSessionDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nyaruka-session-test-'));
  tempRoots.add(root);
  const sessionDirectory = path.join(root, 'session');
  fs.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sessionDirectory, 'creds.json'), 'test-only opaque auth marker', { mode: 0o600 });
  return { root, sessionDirectory, credsPath: path.join(sessionDirectory, 'creds.json') };
}

function loggedOutError() {
  return Object.assign(new Error('Stream Errored'), {
    reason: 'loggedOut',
    output: { statusCode: 401 },
  });
}

function makeReconnectLogCapture() {
  const messages = [];
  const entries = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [
    level,
    (details, message) => {
      messages.push(message);
      entries.push({ level, details, message });
    },
  ]));
  return { logger, messages, entries };
}

function makeFakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs, cleared: false, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
    async fireNext() {
      const timer = timers.find((candidate) => !candidate.cleared && !candidate.fired);
      assert.ok(timer, 'expected a pending retry timer');
      timer.fired = true;
      timer.callback();
      await new Promise((resolve) => setImmediate(resolve));
      return timer;
    },
  };
}

test('408 and WebSocket timeouts retry without quarantining or modifying auth', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const timers = makeFakeTimers();
  const socket = { id: 'socket-408' };
  const reconnectLog = makeReconnectLogCapture();
  let quarantineCalls = 0;
  const controller = createReconnectController({
    connect: async () => socket,
    closeSocket: async () => {},
    quarantine: async () => { quarantineCalls += 1; },
    onDiagnostic: (event, details) => logReconnectDiagnostic(reconnectLog.logger, event, details),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  await controller.handleDisconnect(socket, { output: { statusCode: 408 } });

  assert.equal(classifyDisconnect({ message: 'WebSocket connection timed out' }), 'retry');
  assert.equal(quarantineCalls, 0);
  assert.equal(fs.existsSync(sessionDirectory), true);
  assert.equal(fs.readFileSync(credsPath, 'utf8'), originalContents);
  assert.equal(fs.readdirSync(path.dirname(sessionDirectory)).some((name) => name.includes('.quarantine-')), false);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);
  assert.deepEqual(reconnectLog.messages, [
    '⚠️ Koneksi WhatsApp terputus. Nyaruka mencoba menyambung kembali; sesi tetap disimpan.',
  ]);
  assert.equal(/logout|corrupt|clear|reset|keluar|rusak/i.test(JSON.stringify(reconnectLog.entries)), false);
});

test('only explicit loggedOut quarantines auth; bare 401 and ambiguous errors do not', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const timers = makeFakeTimers();
  const diagnostics = [];
  const reconnectLog = makeReconnectLogCapture();
  const socket = { id: 'socket-logout' };
  let pairingRequired = 0;
  let quarantinePath;
  const controller = createReconnectController({
    connect: async () => socket,
    closeSocket: async () => {},
    quarantine: async () => {
      quarantinePath = quarantineSession(sessionDirectory, { now: () => 1234 });
      return quarantinePath;
    },
    onPairingRequired: () => { pairingRequired += 1; },
    onDiagnostic: (event, details) => {
      diagnostics.push({ event, details });
      logReconnectDiagnostic(reconnectLog.logger, event, details);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  assert.equal(classifyDisconnect({ output: { statusCode: 401 } }), 'stop');
  assert.equal(classifyDisconnect(loggedOutError()), 'logout');
  await controller.handleDisconnect(socket, loggedOutError());

  assert.ok(quarantinePath);
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'creds.json'), 'utf8'), originalContents);
  assert.equal(fs.existsSync(sessionDirectory), true);
  assert.deepEqual(fs.readdirSync(sessionDirectory), []);
  assert.equal(pairingRequired, 1);
  assert.equal(diagnostics.some(({ event }) => event === 'session_quarantined'), true);
  assert.deepEqual(reconnectLog.messages.slice(0, 2), [
    '🔐 WhatsApp melaporkan sesi telah keluar. Pairing ulang diperlukan untuk menyambungkan kembali.',
    '🧹 Sesi lokal sudah direset. Pairing ulang diperlukan.',
  ]);

  const ambiguousTimers = makeFakeTimers();
  const ambiguousController = createReconnectController({
    connect: async () => ({ id: 'socket-ambiguous' }),
    closeSocket: async () => {},
    quarantine: async () => { throw new Error('must not quarantine ambiguous errors'); },
    setTimer: ambiguousTimers.setTimer,
    clearTimer: ambiguousTimers.clearTimer,
  });
  const ambiguousSocket = await ambiguousController.connect();
  await ambiguousController.handleDisconnect(ambiguousSocket, new Error('Bad MAC while decrypting auth'));
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'creds.json'), 'utf8'), originalContents);
  assert.equal(ambiguousTimers.timers.filter((timer) => !timer.cleared).length, 0);

  const bare401Timers = makeFakeTimers();
  let bare401QuarantineCalls = 0;
  const bare401Controller = createReconnectController({
    connect: async () => ({ id: 'socket-bare-401' }),
    closeSocket: async () => {},
    quarantine: async () => { bare401QuarantineCalls += 1; },
    setTimer: bare401Timers.setTimer,
    clearTimer: bare401Timers.clearTimer,
  });
  const bare401Socket = await bare401Controller.connect();
  await bare401Controller.handleDisconnect(bare401Socket, { output: { statusCode: 401 } });
  assert.equal(bare401QuarantineCalls, 0);
  assert.equal(bare401Timers.timers.filter((timer) => !timer.cleared).length, 0);
});

test('concurrent connects are single-flight and transient retries use capped exponential jitter', async () => {
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-1' };
  const secondSocket = { id: 'socket-2' };
  let resolveFirst;
  let connectCalls = 0;
  let openSockets = 0;
  const controller = createReconnectController({
    connect: () => {
      connectCalls += 1;
      if (connectCalls === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => {
            openSockets += 1;
            resolve(firstSocket);
          };
        });
      }
      openSockets += 1;
      return Promise.resolve(secondSocket);
    },
    closeSocket: async () => { openSockets -= 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
    baseDelayMs: 1_000,
    maxDelayMs: 1_500,
  });

  const first = controller.connect();
  const duplicate = controller.connect();
  assert.equal(first, duplicate);
  resolveFirst();
  assert.equal(await first, firstSocket);
  assert.equal(connectCalls, 1);

  await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  assert.equal(openSockets, 0);
  const firstRetry = timers.timers.find((timer) => !timer.cleared && !timer.fired);
  assert.equal(firstRetry.delayMs, 500);
  await timers.fireNext();
  assert.equal(connectCalls, 2);
  assert.equal(controller.getSocket(), secondSocket);
  assert.equal(openSockets, 1);

  await controller.handleDisconnect(secondSocket, { code: 'ECONNRESET' });
  const retryTimers = timers.timers.filter((timer) => !timer.cleared);
  assert.equal(retryTimers.at(-1).delayMs, 750);
  assert.equal(calculateRetryDelay(10, { baseDelayMs: 1_000, maxDelayMs: 1_500, random: () => 1 }), 1_500);
});

test('credential writes are awaited, serialized, and report failure without leaking auth details', async () => {
  const sensitiveMessage = 'phone 15551234567 jid 12345@s.whatsapp.net key private-auth-value';
  const failure = Object.assign(new Error(sensitiveMessage), { code: 'EIO', statusCode: 503 });
  const events = [];
  let releaseFirstWrite;
  let calls = 0;
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const persister = createCredentialPersister(() => {
    calls += 1;
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    if (calls === 1) {
      return new Promise((resolve, reject) => {
        releaseFirstWrite = () => {
          activeWrites -= 1;
          reject(failure);
        };
      });
    }
    activeWrites -= 1;
    return Promise.resolve();
  }, (event, details) => events.push({ event, details }));

  const first = persister();
  const second = persister();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(events, []);

  releaseFirstWrite();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(calls, 2);
  assert.equal(maxActiveWrites, 1);
  assert.deepEqual(events, [
    { event: 'failed', details: { errorType: 'Error', errorCode: 'EIO', statusCode: 503 } },
    { event: 'saved', details: {} },
  ]);
  assert.equal(JSON.stringify(events).includes(sensitiveMessage), false);
  assert.equal(JSON.stringify(events).includes('15551234567'), false);
  assert.equal(JSON.stringify(events).includes('private-auth-value'), false);
});

test('credential writes remain serialized across reconnecting socket generations', async () => {
  const queue = { current: Promise.resolve() };
  const order = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let releaseFirst;
  const firstSocketPersister = createCredentialPersister(() => {
    order.push('old-socket-start');
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    return new Promise((resolve) => {
      releaseFirst = () => {
        activeWrites -= 1;
        order.push('old-socket-finished');
        resolve();
      };
    });
  }, () => {}, queue);
  const nextSocketPersister = createCredentialPersister(async () => {
    order.push('new-socket-start');
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    activeWrites -= 1;
    order.push('new-socket-finished');
  }, () => {}, queue);

  const firstWrite = firstSocketPersister();
  const nextWrite = nextSocketPersister();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['old-socket-start']);
  releaseFirst();
  assert.equal(await firstWrite, true);
  assert.equal(await nextWrite, true);
  assert.deepEqual(order, [
    'old-socket-start',
    'old-socket-finished',
    'new-socket-start',
    'new-socket-finished',
  ]);
  assert.equal(maxActiveWrites, 1);
});

test('explicit logout quarantines state, while quarantine failure preserves it and stops retrying', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const timers = makeFakeTimers();
  const socket = { id: 'socket-explicit-logout' };
  let quarantinePath;
  const controller = createReconnectController({
    connect: async () => socket,
    closeSocket: async () => {},
    quarantine: async () => {
      quarantinePath = quarantineSession(sessionDirectory, { now: () => 4321 });
      return quarantinePath;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  assert.equal(await controller.logout(), true);
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'creds.json'), 'utf8'), originalContents);
  assert.deepEqual(fs.readdirSync(sessionDirectory), []);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);

  const failedSession = makeSessionDirectory();
  const failedOriginal = fs.readFileSync(failedSession.credsPath, 'utf8');
  const failedTimers = makeFakeTimers();
  const diagnostics = [];
  const failedReconnectLog = makeReconnectLogCapture();
  const failedSocket = { id: 'socket-quarantine-failure' };
  const failedController = createReconnectController({
    connect: async () => failedSocket,
    closeSocket: async () => {},
    quarantine: async () => { throw Object.assign(new Error('private auth path / phone 15551234567'), { code: 'EIO' }); },
    onDiagnostic: (event, details) => {
      diagnostics.push({ event, details });
      logReconnectDiagnostic(failedReconnectLog.logger, event, details);
    },
    setTimer: failedTimers.setTimer,
    clearTimer: failedTimers.clearTimer,
  });

  await failedController.connect();
  await failedController.handleDisconnect(failedSocket, loggedOutError());
  assert.equal(fs.readFileSync(failedSession.credsPath, 'utf8'), failedOriginal);
  assert.equal(failedTimers.timers.filter((timer) => !timer.cleared).length, 0);
  assert.equal(await failedController.connect(), null);
  assert.deepEqual(diagnostics, [
    { event: 'logout_confirmed', details: { statusCode: 401 } },
    { event: 'session_quarantine_failed', details: { errorType: 'Error', errorCode: 'EIO' } },
  ]);
  assert.equal(failedReconnectLog.messages.includes('🧹 Sesi lokal sudah direset. Pairing ulang diperlukan.'), false);
  assert.equal(JSON.stringify(diagnostics).includes('15551234567'), false);
});

test('confirmed logout drains pending credential writes before moving the session directory', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const queue = { current: Promise.resolve() };
  let releaseWrite;
  const persistCredentials = createCredentialPersister(() => new Promise((resolve) => {
    releaseWrite = () => {
      fs.writeFileSync(credsPath, 'late credential update completed');
      resolve();
    };
  }), () => {}, queue);
  const pendingWrite = persistCredentials();
  await new Promise((resolve) => setImmediate(resolve));

  const timers = makeFakeTimers();
  const socket = { id: 'socket-logout-pending-save' };
  let quarantinePath;
  const controller = createReconnectController({
    connect: async () => socket,
    closeSocket: async () => {},
    quarantine: async () => {
      await queue.current;
      quarantinePath = quarantineSession(sessionDirectory, { now: () => 5432 });
      return quarantinePath;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  const disconnect = controller.handleDisconnect(socket, loggedOutError());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quarantinePath, undefined);
  assert.equal(fs.existsSync(sessionDirectory), true);

  releaseWrite();
  assert.equal(await pendingWrite, true);
  await disconnect;
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'creds.json'), 'utf8'), 'late credential update completed');
  assert.deepEqual(fs.readdirSync(sessionDirectory), []);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);
});

test('quarantine restores the original directory if replacement creation fails after rename', () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const quarantineFileSystem = {
    existsSync: fs.existsSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    mkdirSync(directory, options) {
      if (directory === sessionDirectory) throw Object.assign(new Error('private session path'), { code: 'EACCES' });
      return fs.mkdirSync(directory, options);
    },
  };

  assert.throws(
    () => quarantineSession(sessionDirectory, { fileSystem: quarantineFileSystem, now: () => 6543 }),
    (error) => error.code === 'EACCES',
  );
  assert.equal(fs.readFileSync(credsPath, 'utf8'), originalContents);
  assert.equal(fs.readdirSync(path.dirname(sessionDirectory)).some((name) => name.includes('.quarantine-')), false);
});

test('logout drains in-flight Signal-key writes and skips queued writes from the stale socket', async () => {
  const { sessionDirectory } = makeSessionDirectory();
  const keyPath = path.join(sessionDirectory, 'session-test-key.json');
  const queue = { current: Promise.resolve() };
  const socket = { id: 'socket-key-write' };
  let controller;
  let releaseFirstWrite;
  let storeWriteCalls = 0;
  const keys = createQueuedKeyStore({
    get: async () => ({}),
    set: async (data) => {
      storeWriteCalls += 1;
      if (storeWriteCalls === 1) {
        await new Promise((resolve) => { releaseFirstWrite = resolve; });
        fs.writeFileSync(keyPath, data.session.first);
      } else {
        fs.writeFileSync(keyPath, data.session.second);
      }
    },
  }, {
    queue,
    isActive: () => controller?.getSocket() === socket,
  });
  const timers = makeFakeTimers();
  let quarantinePath;
  controller = createReconnectController({
    connect: async () => socket,
    closeSocket: async () => {},
    quarantine: async () => {
      await queue.current;
      quarantinePath = quarantineSession(sessionDirectory, { now: () => 7654 });
      return quarantinePath;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  const firstWrite = keys.set({ session: { first: 'first pending key write' } });
  await new Promise((resolve) => setImmediate(resolve));
  const queuedStaleWrite = keys.set({ session: { second: 'must not reach the new session' } });
  assert.equal(storeWriteCalls, 1);

  const disconnect = controller.handleDisconnect(socket, loggedOutError());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quarantinePath, undefined);
  await keys.set({ session: { second: 'ignored after logout begins' } });
  releaseFirstWrite();
  await Promise.all([firstWrite, queuedStaleWrite]);
  await disconnect;

  assert.equal(storeWriteCalls, 1);
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'session-test-key.json'), 'utf8'), 'first pending key write');
  assert.deepEqual(fs.readdirSync(sessionDirectory), []);
});


test('failed credential save is tracked and retried before auth reload on restart', async () => {
  const queue = { current: Promise.resolve() };
  const timers = makeFakeTimers();
  let saveCalls = 0;
  let connectCalls = 0;
  const firstSocket = { id: 'socket-before-save-restart' };
  const nextSocket = { id: 'socket-after-save-restart' };
  const persistCredentials = createCredentialPersister(async () => {
    saveCalls += 1;
    if (saveCalls === 1) throw Object.assign(new Error('synthetic disk write failure'), { code: 'EIO' });
  }, () => {}, queue);
  const controller = createReconnectController({
    connect: async () => {
      connectCalls += 1;
      if (connectCalls === 1) return firstSocket;
      assert.equal(await retryFailedCredentialSave(queue), true);
      return nextSocket;
    },
    closeSocket: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  assert.equal(await persistCredentials(), false);
  assert.equal(typeof queue.pendingSave, 'function');
  await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await timers.fireNext();

  assert.equal(saveCalls, 2);
  assert.equal(queue.pendingSave, null);
  assert.equal(controller.getSocket(), nextSocket);
  assert.equal(connectCalls, 2);
});

test('clean WebSocket close without a disconnect error schedules a reconnect', async () => {
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-clean-close' };
  const nextSocket = { id: 'socket-after-clean-close' };
  let connectCalls = 0;
  let quarantineCalls = 0;
  const controller = createReconnectController({
    connect: async () => (++connectCalls === 1 ? firstSocket : nextSocket),
    closeSocket: async () => {},
    quarantine: async () => { quarantineCalls += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  await controller.handleDisconnect(firstSocket, undefined);
  assert.equal(controller.getSocket(), null);
  assert.equal(quarantineCalls, 0);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);
  await timers.fireNext();
  assert.equal(controller.getSocket(), nextSocket);
  assert.equal(quarantineCalls, 0);
});

test('unknown WebSocket errors close the stale socket and recover with auth preserved', async () => {
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-unknown-error' };
  const nextSocket = { id: 'socket-recovered-after-unknown-error' };
  let connectCalls = 0;
  let closeCalls = 0;
  let quarantineCalls = 0;
  const controller = createReconnectController({
    connect: async () => (++connectCalls === 1 ? firstSocket : nextSocket),
    closeSocket: async () => { closeCalls += 1; },
    quarantine: async () => { quarantineCalls += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  await controller.handleSocketError(firstSocket, Object.assign(new Error('synthetic unknown socket failure'), { code: 'EUNKNOWN' }));
  assert.equal(closeCalls, 1);
  assert.equal(controller.getSocket(), null);
  assert.equal(quarantineCalls, 0);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);
  await timers.fireNext();
  assert.equal(controller.getSocket(), nextSocket);
  assert.equal(connectCalls, 2);
  assert.equal(quarantineCalls, 0);
});

test('pairing codes stay on an interactive TTY and legacy Pino fields are redacted', async () => {
  const syntheticCode = 'TESTCODE1234';
  let redirectedOutput = '';
  const redirectedStdout = {
    isTTY: false,
    write(chunk) { redirectedOutput += chunk; },
  };
  assert.equal(writePairingCodeToTerminal(syntheticCode, { stdout: redirectedStdout }), false);
  assert.equal(redirectedOutput, '');

  let terminalOutput = '';
  const terminalStdout = {
    isTTY: true,
    write(chunk) { terminalOutput += chunk; },
  };
  assert.equal(writePairingCodeToTerminal(syntheticCode, { stdout: terminalStdout }), true);
  assert.equal(terminalOutput.includes('TEST-CODE-1234'), true);

  let logOutput = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      logOutput += chunk.toString();
      callback();
    },
  });
  const logger = createLogger({ level: 'info', pretty: false }, destination);
  logger.info({
    code: syntheticCode,
    pairingCode: syntheticCode,
    pairing_code: syntheticCode,
    nested: { pairingCode: syntheticCode },
    errorCode: 'EIO',
  }, 'Legacy pairing-code-bearing output');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logOutput.includes(syntheticCode), false);
  assert.equal((logOutput.match(/\[REDACTED\]/g) || []).length >= 4, true);
  assert.equal(logOutput.includes('"errorCode":"EIO"'), true);
});
