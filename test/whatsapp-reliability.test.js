import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, test } from 'node:test';

import { createLogger } from '../lib/utils/logger.js';
import { writePairingCodeToTerminal } from '../lib/whatsapp/pairing-output.js';
import { logReconnectDiagnostic } from '../lib/whatsapp/reconnect-logging.js';
import { installFatalProcessHandlers } from '../lib/whatsapp/process-guards.js';
import { closeWhatsAppSocket, trackWhatsAppSocket } from '../lib/whatsapp/socket-close.js';
import {
  calculateRetryDelay,
  classifyDisconnect,
  createCredentialPersister,
  createQueuedKeyStore,
  createReconnectController,
  discardFailedCredentialSaveAfterSessionReset,
  discardFailedKeyWritesAfterSessionReset,
  quarantineSession,
  retryFailedCredentialSave,
  retryFailedKeyWrites,
  runConnectStage,
  waitForKeyWriteQueueDrain,
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

function baileysFailure401() {
  return Object.assign(new Error('Connection Failure'), {
    output: { statusCode: 401 },
    data: { reason: '401' },
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
  assert.equal(classifyDisconnect(baileysFailure401()), 'logout');
  assert.equal(classifyDisconnect({ message: 'Connection Failure', output: { statusCode: 401 }, data: { reason: '500' } }), 'stop');
  await controller.handleDisconnect(socket, baileysFailure401());

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

test('successful session reset discards failed writes bound to the old auth directory', async () => {
  const { sessionDirectory } = makeSessionDirectory();
  let staleCredentialRetries = 0;
  let staleKeyRetries = 0;
  const credentialQueue = {
    current: Promise.resolve(),
    pendingSave: async () => { staleCredentialRetries += 1; },
  };
  const keyQueue = {
    current: Promise.resolve(),
    pendingWrites: [{ retry: async () => { staleKeyRetries += 1; }, report: () => {} }],
    dirty: true,
  };

  const quarantinedPath = quarantineSession(sessionDirectory, { now: () => 112233 });
  assert.ok(quarantinedPath);
  discardFailedCredentialSaveAfterSessionReset(credentialQueue);
  discardFailedKeyWritesAfterSessionReset(keyQueue);
  assert.equal(await retryFailedCredentialSave(credentialQueue), true);
  assert.equal(await retryFailedKeyWrites(keyQueue), true);
  assert.equal(staleCredentialRetries, 0);
  assert.equal(staleKeyRetries, 0);
  assert.equal(keyQueue.dirty, false);
});

test('failed Signal-key writes stay dirty and block auth reload until repaired on restart', async () => {
  const queue = { current: Promise.resolve() };
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-before-key-repair' };
  const nextSocket = { id: 'socket-after-key-repair' };
  let controller;
  let keySaveCalls = 0;
  let connectCalls = 0;
  let authReloads = 0;
  const keys = createQueuedKeyStore({
    get: async () => ({}),
    set: async () => {
      keySaveCalls += 1;
      if (keySaveCalls <= 2) throw Object.assign(new Error('synthetic Signal-key disk failure'), { code: 'EIO' });
    },
  }, { queue, isActive: () => true });

  controller = createReconnectController({
    connect: async () => {
      connectCalls += 1;
      if (connectCalls === 1) {
        authReloads += 1;
        return firstSocket;
      }
      if (!(await retryFailedKeyWrites(queue))) {
        throw Object.assign(new Error('Signal-key save remains pending'), { code: 'EAGAIN' });
      }
      authReloads += 1;
      return nextSocket;
    },
    closeSocket: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  await assert.rejects(keys.set({ session: { synthetic: 'opaque test key marker' } }), /synthetic Signal-key disk failure/);
  assert.equal(queue.dirty, true);
  await assert.rejects(keys.set({ session: { later: 'queued behind failed key write' } }), /pending repair/);
  assert.equal(queue.pendingWrites.length, 2);
  assert.equal(keySaveCalls, 1);

  await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await timers.fireNext();
  assert.equal(authReloads, 1);
  assert.equal(queue.dirty, true);
  assert.equal(queue.pendingWrites.length, 2);
  assert.equal(controller.getSocket(), null);

  await timers.fireNext();
  assert.equal(keySaveCalls, 4);
  assert.equal(authReloads, 2);
  assert.equal(queue.dirty, false);
  assert.deepEqual(queue.pendingWrites, []);
  assert.equal(controller.getSocket(), nextSocket);
});

test('reconnect waits for an active Signal-key write and repairs its failure before auth reload', async () => {
  const queue = { current: Promise.resolve() };
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-before-inflight-key-write' };
  const nextSocket = { id: 'socket-after-inflight-key-repair' };
  let rejectInitialWrite;
  let resolveRepair;
  let initialWriteStarted;
  let repairStarted;
  const initialStarted = new Promise((resolve) => { initialWriteStarted = resolve; });
  const repairHasStarted = new Promise((resolve) => { repairStarted = resolve; });
  let keySaveCalls = 0;
  let connectCalls = 0;
  let authReloads = 0;
  const keys = createQueuedKeyStore({
    get: async () => ({}),
    set: async () => {
      keySaveCalls += 1;
      if (keySaveCalls === 1) {
        initialWriteStarted();
        return new Promise((_resolve, reject) => { rejectInitialWrite = reject; });
      }
      if (keySaveCalls === 2) {
        repairStarted();
        return new Promise((resolve) => { resolveRepair = resolve; });
      }
    },
  }, { queue, isActive: () => true });
  const controller = createReconnectController({
    connect: async () => {
      connectCalls += 1;
      if (connectCalls === 1) return firstSocket;
      if (!(await retryFailedKeyWrites(queue, { timeoutMs: 1_000 }))) {
        throw Object.assign(new Error('Signal-key save remains pending'), { code: 'EAGAIN' });
      }
      authReloads += 1;
      return nextSocket;
    },
    closeSocket: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  const activeWrite = keys.set({ session: { synthetic: 'pending test key marker' } });
  await initialStarted;
  await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await timers.fireNext();
  const reconnectPromise = controller.connect();
  assert.equal(authReloads, 0);
  assert.equal(queue.recoveryBlocked, true);

  rejectInitialWrite(new Error('synthetic in-flight Signal-key write failure'));
  await assert.rejects(activeWrite, /synthetic in-flight Signal-key write failure/);
  await repairHasStarted;
  assert.equal(keySaveCalls, 2);
  assert.equal(authReloads, 0);
  assert.equal(queue.dirty, true);
  assert.equal(queue.pendingWrites.length, 1);
  assert.equal(controller.getSocket(), null);

  resolveRepair();
  assert.equal(await reconnectPromise, nextSocket);
  assert.equal(authReloads, 1);
  assert.equal(queue.dirty, false);
  assert.equal(queue.recoveryBlocked, false);
  assert.deepEqual(queue.pendingWrites, []);
  assert.equal(controller.getSocket(), nextSocket);
});

test('Signal-key queue recovery times out as unhealthy instead of hanging or allowing auth reload', async () => {
  const queue = { current: new Promise(() => {}) };
  const startedAt = Date.now();

  assert.equal(await retryFailedKeyWrites(queue, { timeoutMs: 5 }), false);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(queue.dirty, true);
  assert.equal(queue.recoveryBlocked, true);
});

test('terminal logout preempts a connect waiting on key recovery, quarantines once, then continues pairing once', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const queue = { current: Promise.resolve() };
  const timers = makeFakeTimers();
  const firstSocket = { id: 'socket-before-terminal-during-key-repair' };
  const unsafeSocket = { id: 'must-not-start-before-quarantine' };
  const pairingSocket = { id: 'pairing-socket-after-quarantine' };
  let rejectInitialWrite;
  let resolveRepair;
  let signalInitialWrite;
  let signalRecoveryStart;
  let signalRepairStart;
  const initialWriteStarted = new Promise((resolve) => { signalInitialWrite = resolve; });
  const recoveryStarted = new Promise((resolve) => { signalRecoveryStart = resolve; });
  const repairStarted = new Promise((resolve) => { signalRepairStart = resolve; });
  let keySaveCalls = 0;
  let connectCalls = 0;
  let authLoads = 0;
  let socketStarts = 0;
  let quarantineCalls = 0;
  let pairingRequired = 0;
  let quarantinePath;
  const diagnostics = [];
  const reconnectLog = makeReconnectLogCapture();
  const keys = createQueuedKeyStore({
    get: async () => ({}),
    set: async () => {
      keySaveCalls += 1;
      if (keySaveCalls === 1) {
        signalInitialWrite();
        return new Promise((_resolve, reject) => { rejectInitialWrite = reject; });
      }
      if (keySaveCalls === 2) {
        signalRepairStart();
        return new Promise((resolve) => { resolveRepair = resolve; });
      }
    },
  }, { queue, isActive: () => true });
  const controller = createReconnectController({
    connect: async (_registerSocket, { signal }) => {
      connectCalls += 1;
      if (connectCalls === 1) {
        authLoads += 1;
        socketStarts += 1;
        return firstSocket;
      }
      if (connectCalls === 2) {
        signalRecoveryStart();
        const healthy = await runConnectStage(
          signal,
          () => retryFailedKeyWrites(queue, { timeoutMs: 1_000 }),
        );
        if (!healthy) throw Object.assign(new Error('Signal-key save remains pending'), { code: 'EAGAIN' });
        authLoads += 1;
        socketStarts += 1;
        return unsafeSocket;
      }
      if (connectCalls === 3) {
        const healthy = await runConnectStage(signal, async () => true);
        assert.equal(healthy, true);
        authLoads += 1;
        socketStarts += 1;
        return pairingSocket;
      }
      throw new Error('unexpected extra connect attempt');
    },
    closeSocket: async () => true,
    quarantine: async () => {
      quarantineCalls += 1;
      if (!(await waitForKeyWriteQueueDrain(queue, { timeoutMs: 1_000 }))) {
        throw new Error('Signal-key writes did not drain before quarantine');
      }
      quarantinePath = quarantineSession(sessionDirectory, { now: () => 223344 });
      if (quarantinePath) discardFailedKeyWritesAfterSessionReset(queue);
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
  const activeWrite = keys.set({ session: { synthetic: 'terminal-race test marker' } });
  await initialWriteStarted;
  await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await timers.fireNext();
  await recoveryStarted;

  const logout = controller.handleDisconnect(firstSocket, baileysFailure401());
  assert.equal(queue.recoveryBlocked, true);
  assert.equal(authLoads, 1);
  assert.equal(socketStarts, 1);
  assert.equal(quarantineCalls, 0);

  rejectInitialWrite(new Error('synthetic key write rejected during terminal logout'));
  await assert.rejects(activeWrite, /synthetic key write rejected during terminal logout/);
  await repairStarted;
  assert.equal(authLoads, 1);
  assert.equal(socketStarts, 1);
  assert.equal(quarantineCalls, 0);
  assert.equal(queue.pendingWrites.length, 1);
  assert.equal(controller.getSocket(), null);

  resolveRepair();
  assert.equal(await logout, true);
  assert.equal(quarantineCalls, 1);
  assert.equal(pairingRequired, 1);
  assert.ok(quarantinePath);
  assert.equal(fs.readFileSync(path.join(quarantinePath, 'creds.json'), 'utf8'), originalContents);
  assert.equal(fs.existsSync(sessionDirectory), true);
  assert.deepEqual(fs.readdirSync(sessionDirectory), []);
  assert.equal(queue.dirty, false);
  assert.deepEqual(queue.pendingWrites, []);
  assert.equal(authLoads, 1);
  assert.equal(socketStarts, 1);
  assert.equal(diagnostics.filter(({ event }) => event === 'session_quarantined').length, 1);
  assert.deepEqual(
    diagnostics.filter(({ event }) => event === 'retry_scheduled').map(({ details }) => details.reason),
    ['transient', 'pairing'],
  );
  const logoutMessageIndex = reconnectLog.messages.indexOf(
    '🔐 WhatsApp melaporkan sesi telah keluar. Pairing ulang diperlukan untuk menyambungkan kembali.',
  );
  const resetMessageIndex = reconnectLog.messages.indexOf('🧹 Sesi lokal sudah direset. Pairing ulang diperlukan.');
  assert.ok(logoutMessageIndex >= 0);
  assert.ok(resetMessageIndex > logoutMessageIndex);

  await timers.fireNext();
  assert.equal(await controller.connect(), pairingSocket);
  assert.equal(connectCalls, 3);
  assert.equal(authLoads, 2);
  assert.equal(socketStarts, 2);
  assert.equal(controller.getSocket(), pairingSocket);
  assert.equal(diagnostics.filter(({ event, details }) => event === 'retry_scheduled' && details.reason === 'pairing').length, 1);
});

test('terminal logout timeout preserves auth and reports quarantine failure without pairing/reset claims', async () => {
  const { sessionDirectory, credsPath } = makeSessionDirectory();
  const originalContents = fs.readFileSync(credsPath, 'utf8');
  const queue = { current: Promise.resolve() };
  const timers = makeFakeTimers();
  const socket = { id: 'socket-before-key-drain-timeout' };
  let releaseWrite;
  let signalWriteStarted;
  let signalRecoveryStarted;
  const writeStarted = new Promise((resolve) => { signalWriteStarted = resolve; });
  const recoveryStarted = new Promise((resolve) => { signalRecoveryStarted = resolve; });
  let authLoads = 0;
  let connectCalls = 0;
  let quarantineCalls = 0;
  let resetCalls = 0;
  let pairingRequired = 0;
  const diagnostics = [];
  const reconnectLog = makeReconnectLogCapture();
  const keys = createQueuedKeyStore({
    get: async () => ({}),
    set: async () => {
      signalWriteStarted();
      return new Promise((resolve) => { releaseWrite = resolve; });
    },
  }, { queue, isActive: () => true });
  const controller = createReconnectController({
    connect: async (_registerSocket, { signal }) => {
      connectCalls += 1;
      if (connectCalls === 1) {
        authLoads += 1;
        return socket;
      }
      signalRecoveryStarted();
      const healthy = await runConnectStage(
        signal,
        () => retryFailedKeyWrites(queue, { timeoutMs: 15 }),
      );
      if (!healthy) throw Object.assign(new Error('Signal-key save remains pending'), { code: 'EAGAIN' });
      authLoads += 1;
      return { id: 'must-not-start-after-timeout' };
    },
    closeSocket: async () => true,
    quarantine: async () => {
      quarantineCalls += 1;
      if (!(await waitForKeyWriteQueueDrain(queue, { timeoutMs: 15 }))) {
        throw new Error('Signal-key writes did not reach a safe quarantine boundary');
      }
      resetCalls += 1;
      const moved = quarantineSession(sessionDirectory, { now: () => 334455 });
      if (moved) discardFailedKeyWritesAfterSessionReset(queue);
      return moved;
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
  const activeWrite = keys.set({ session: { synthetic: 'timeout-preserve marker' } });
  await writeStarted;
  await controller.handleDisconnect(socket, { output: { statusCode: 408 } });
  await timers.fireNext();
  await recoveryStarted;
  assert.equal(await controller.handleDisconnect(socket, baileysFailure401()), false);

  assert.equal(authLoads, 1);
  assert.equal(connectCalls, 2);
  assert.equal(quarantineCalls, 1);
  assert.equal(resetCalls, 0);
  assert.equal(pairingRequired, 0);
  assert.equal(fs.existsSync(sessionDirectory), true);
  assert.equal(fs.readFileSync(credsPath, 'utf8'), originalContents);
  assert.equal(fs.readdirSync(path.dirname(sessionDirectory)).some((name) => name.includes('.quarantine-')), false);
  assert.equal(diagnostics.filter(({ event }) => event === 'session_quarantine_failed').length, 1);
  assert.equal(diagnostics.some(({ event }) => event === 'session_quarantined'), false);
  assert.equal(reconnectLog.messages.includes('🧹 Sesi lokal sudah direset. Pairing ulang diperlukan.'), false);
  assert.equal(timers.timers.filter((timer) => !timer.cleared && !timer.fired).length, 0);
  assert.equal(await controller.connect(), null);

  releaseWrite();
  await activeWrite;
  assert.equal(queue.dirty, true);
  assert.equal(queue.recoveryBlocked, true);
  assert.equal(fs.readFileSync(credsPath, 'utf8'), originalContents);
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

test('terminal logout queued during an in-flight close wins over a transient retry', async () => {
  const timers = makeFakeTimers();
  const diagnostics = [];
  const firstSocket = { id: 'socket-close-then-logout' };
  let releaseClose;
  let connectCalls = 0;
  let quarantineCalls = 0;
  const controller = createReconnectController({
    connect: async () => (++connectCalls === 1 ? firstSocket : { id: 'socket-after-logout' }),
    closeSocket: () => new Promise((resolve) => {
      releaseClose = () => resolve(true);
    }),
    quarantine: async () => {
      quarantineCalls += 1;
      return '/synthetic/quarantined-session';
    },
    onDiagnostic: (event, details) => diagnostics.push({ event, details }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  const transientTransition = controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 0);

  const logoutTransition = controller.handleDisconnect(firstSocket, baileysFailure401());
  releaseClose();
  await Promise.all([transientTransition, logoutTransition]);

  assert.equal(quarantineCalls, 1);
  assert.equal(connectCalls, 1);
  assert.deepEqual(diagnostics.filter(({ event }) => event === 'retry_scheduled').map(({ details }) => details.reason), ['pairing']);
  assert.equal(diagnostics.filter(({ event }) => event === 'logout_confirmed').length, 1);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);
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

test('retry waits for the raw Baileys WebSocket close after sock.end removes wrapper listeners', async () => {
  const timers = makeFakeTimers();
  const wrapper = new EventEmitter();
  const rawSocket = new EventEmitter();
  rawSocket.readyState = 1;
  wrapper.socket = rawSocket;
  Object.defineProperties(wrapper, {
    isClosed: { get: () => !wrapper.socket || wrapper.socket.readyState === 3 },
    isClosing: { get: () => !wrapper.socket || wrapper.socket.readyState === 2 },
  });
  let wrapperCloseEvents = 0;
  wrapper.on('close', () => { wrapperCloseEvents += 1; });
  let closeStarted = false;
  const firstSocket = {
    ws: wrapper,
    end() {
      wrapper.removeAllListeners('close');
      if (!closeStarted) {
        closeStarted = true;
        rawSocket.readyState = 2;
        wrapper.socket = null;
        setTimeout(() => {
          rawSocket.readyState = 3;
          rawSocket.emit('close');
        }, 15);
      }
    },
  };
  assert.equal(trackWhatsAppSocket(firstSocket), true);
  const nextSocket = { id: 'socket-after-raw-close' };
  let connectCalls = 0;
  const controller = createReconnectController({
    connect: async () => {
      connectCalls += 1;
      if (connectCalls === 1) return firstSocket;
      assert.equal(rawSocket.readyState, 3);
      return nextSocket;
    },
    closeSocket: (socket) => closeWhatsAppSocket(socket, { timeoutMs: 100 }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  firstSocket.end(); // Baileys end() has already nulled the wrapper socket and removed its close listener.
  const transition = controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rawSocket.readyState, 2);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 0);
  assert.equal(await transition, true);
  assert.equal(rawSocket.readyState, 3);
  assert.equal(wrapperCloseEvents, 0);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 1);

  await timers.fireNext();
  assert.equal(controller.getSocket(), nextSocket);
  assert.equal(connectCalls, 2);
});

test('unconfirmed socket close blocks retry and resume from opening a concurrent socket', async () => {
  const timers = makeFakeTimers();
  const wrapper = new EventEmitter();
  const rawSocket = new EventEmitter();
  rawSocket.readyState = 1;
  wrapper.socket = rawSocket;
  Object.defineProperties(wrapper, {
    isClosed: { get: () => !wrapper.socket || wrapper.socket.readyState === 3 },
    isClosing: { get: () => !wrapper.socket || wrapper.socket.readyState === 2 },
  });
  const firstSocket = {
    ws: wrapper,
    end() {
      wrapper.removeAllListeners('close');
      rawSocket.readyState = 2;
      wrapper.socket = null;
    },
  };
  let connectCalls = 0;
  const controller = createReconnectController({
    connect: async () => {
      connectCalls += 1;
      return firstSocket;
    },
    closeSocket: (socket) => closeWhatsAppSocket(socket, { timeoutMs: 5 }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0,
  });

  await controller.connect();
  assert.equal(await controller.handleDisconnect(firstSocket, { output: { statusCode: 408 } }), false);
  assert.equal(rawSocket.readyState, 2);
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 0);
  assert.equal(await controller.connect(), null);
  assert.equal(await controller.resume(), null);
  assert.equal(connectCalls, 1);
});

test('fatal process handlers await cleanup and exit nonzero for both fatal event types', async () => {
  for (const eventName of ['uncaughtException', 'unhandledRejection']) {
    const processObject = new EventEmitter();
    const order = [];
    let releaseCleanup;
    const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve; });
    processObject.exit = (code) => order.push(`exit:${code}`);
    const logger = {
      fatal: (_details, message) => order.push(`fatal:${message}`),
      error: (_details, message) => order.push(`error:${message}`),
    };
    const handlers = installFatalProcessHandlers({
      processObject,
      logger,
      cleanup: async () => {
        order.push('cleanup-start');
        await cleanupGate;
        order.push('cleanup-finished');
      },
    });
    const failure = new Error('synthetic fatal process error');

    assert.equal(processObject.listenerCount(eventName), 1);
    processObject.emit(eventName, failure);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(order.includes('cleanup-finished'), false);
    assert.equal(order.some((entry) => entry.startsWith('exit:')), false);

    releaseCleanup();
    await handlers.handleFatalError(failure, eventName);
    assert.deepEqual(order.slice(-2), ['cleanup-finished', 'exit:1']);
    assert.equal(order.filter((entry) => entry === 'exit:1').length, 1);
    handlers.dispose();
    assert.equal(processObject.listenerCount('uncaughtException'), 0);
    assert.equal(processObject.listenerCount('unhandledRejection'), 0);
  }
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
