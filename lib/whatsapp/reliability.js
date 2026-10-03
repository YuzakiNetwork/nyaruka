import fs from 'node:fs';
import path from 'node:path';

const BAD_SESSION_STATUS_CODE = 500;
const MAX_BAD_SESSION_RETRIES = 3;
const RETRYABLE_STATUS_CODES = new Set([405, 408, 428, BAD_SESSION_STATUS_CODE, 503, 515]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAGAIN',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);
const SAFE_ERROR_CODES = new Set([
  ...RETRYABLE_ERROR_CODES,
  'EBUSY',
  'EACCES',
  'EIO',
  'EINVAL',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'EPERM',
  'EROFS',
  'ERR_SOCKET_CLOSED',
  'ERR_STREAM_DESTROYED',
]);
const SAFE_ERROR_NAMES = new Set([
  'AbortError',
  'Error',
  'RangeError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
]);
const CONNECT_STAGE_TIMEOUT_MS = 15_000;

function statusCodeOf(error) {
  const candidates = [
    error?.output?.statusCode,
    error?.statusCode,
    error?.cause?.output?.statusCode,
    error?.cause?.statusCode,
  ];
  return candidates.find((value) => Number.isInteger(value) && value >= 100 && value <= 599);
}

function hasExplicitLoggedOutReason(error) {
  const reasons = [
    error?.reason,
    error?.disconnectReason,
    error?.output?.payload?.reason,
    error?.data?.reason,
    error?.data?.attrs?.reason,
    ...(Array.isArray(error?.data?.content) ? error.data.content.map((node) => node?.tag) : []),
  ];
  const messages = [error?.message, error?.output?.payload?.message];
  return reasons.includes('loggedOut') || messages.includes('Intentional Logout');
}

function hasBaileysFailure401Reason(error) {
  const reason = error?.data?.reason;
  return error?.message === 'Connection Failure'
    && (reason === 401 || reason === '401');
}

export function classifyDisconnect(error) {
  const statusCode = statusCodeOf(error);

  // A numeric 401 alone is ambiguous; quarantine only a clearly identified terminal logout.
  if (statusCode === 401 && (hasExplicitLoggedOutReason(error) || hasBaileysFailure401Reason(error))) return 'logout';
  if (RETRYABLE_STATUS_CODES.has(statusCode)) return 'retry';
  if (RETRYABLE_ERROR_CODES.has(error?.code) || RETRYABLE_ERROR_CODES.has(error?.cause?.code)) {
    return 'retry';
  }
  if (error?.name === 'TimeoutError') return 'retry';

  // Retry explicit transport timeouts/closures only; crypto/auth message text is never
  // interpreted as permission to clear or replace session state.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (
    /\b(?:websocket|web\s*socket|socket|connection)\b.{0,60}\b(?:timeout|timed out|closed|hang up|reset|aborted)\b/i.test(message)
    || /\b(?:timeout|timed out|hang up|reset|aborted)\b.{0,60}\b(?:websocket|web\s*socket|socket|connection)\b/i.test(message)
  ) {
    return 'retry';
  }

  return 'stop';
}

export function sanitizeDiagnostic(error) {
  const diagnostic = {};
  const name = SAFE_ERROR_NAMES.has(error?.name) ? error.name : 'Error';
  const code = SAFE_ERROR_CODES.has(error?.code) ? error.code : undefined;
  const statusCode = statusCodeOf(error);

  diagnostic.errorType = name;
  if (code) diagnostic.errorCode = code;
  if (statusCode !== undefined) diagnostic.statusCode = statusCode;
  return diagnostic;
}

export function calculateRetryDelay(retryCount, {
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
  random = Math.random,
} = {}) {
  const base = Math.max(1, Number(baseDelayMs) || 1_000);
  const maximum = Math.max(base, Number(maxDelayMs) || 60_000);
  const attempt = Math.max(0, Math.min(30, Math.trunc(Number(retryCount) || 0)));
  const exponentialDelay = Math.min(maximum, base * (2 ** attempt));
  const sample = Number(random());
  const boundedSample = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  const jitteredDelay = exponentialDelay * (0.5 + boundedSample * 0.5);
  return Math.min(maximum, Math.max(1, Math.round(jitteredDelay)));
}

/**
 * Move an existing auth directory to a unique sibling path before starting a new
 * pairing flow. The rename stays on the same filesystem and never deletes auth.
 */
export function quarantineSession(sessionDirectory, {
  fileSystem = fs,
  now = Date.now,
} = {}) {
  if (!fileSystem.existsSync(sessionDirectory)) return null;

  const parent = path.dirname(sessionDirectory);
  const name = path.basename(sessionDirectory);
  const timestamp = Math.max(0, Number(now()) || 0);
  let quarantinePath;

  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const tail = suffix === 0 ? '' : `-${suffix}`;
    quarantinePath = path.join(parent, `${name}.quarantine-${timestamp}${tail}`);
    if (!fileSystem.existsSync(quarantinePath)) break;
    quarantinePath = null;
  }

  if (!quarantinePath) throw new Error('No available session quarantine path');

  fileSystem.renameSync(sessionDirectory, quarantinePath);
  try {
    fileSystem.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  } catch (error) {
    try { fileSystem.renameSync(quarantinePath, sessionDirectory); } catch {}
    throw error;
  }
  return quarantinePath;
}

/**
 * Serialize creds.update writes, await each persistence operation, and convert
 * failures to sanitized diagnostics so EventEmitter callbacks cannot leak secrets
 * through an unhandled rejection.
 */
export function createCredentialPersister(saveCreds, report = () => {}, queue = { current: Promise.resolve() }) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }

  function persistCredentials() {
    const operation = queue.current.then(async () => {
      try {
        await saveCreds();
        queue.pendingSave = null;
        try { report('saved', {}); } catch {}
        return true;
      } catch (error) {
        queue.pendingSave = persistCredentials;
        try { report('failed', sanitizeDiagnostic(error)); } catch {}
        return false;
      }
    });

    queue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return persistCredentials;
}

/** Retry the most recent failed credential write before loading auth for a new socket. */
export async function retryFailedCredentialSave(queue) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }

  await queue.current;
  const retry = queue.pendingSave;
  if (typeof retry !== 'function') return true;
  return retry();
}

/** Discard a stale credential retry only after its whole session was reset. */
export function discardFailedCredentialSaveAfterSessionReset(queue) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  queue.pendingSave = null;
}

/**
 * Serialize Baileys Signal-key writes and ignore queued writes from sockets that
 * became stale before their write began. The queue can be shared across sockets.
 */
export function createQueuedKeyStore(store, {
  queue = { current: Promise.resolve() },
  isActive = () => true,
  report = () => {},
} = {}) {
  if (typeof store?.get !== 'function' || typeof store?.set !== 'function') {
    throw new TypeError('store must provide get and set functions');
  }
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  if (!Array.isArray(queue.pendingWrites)) queue.pendingWrites = [];
  if (typeof queue.dirty !== 'boolean') queue.dirty = queue.pendingWrites.length > 0;
  if (typeof queue.recoveryBlocked !== 'boolean') queue.recoveryBlocked = queue.dirty;
  if (!Number.isSafeInteger(queue.unsettledWrites) || queue.unsettledWrites < 0) queue.unsettledWrites = 0;
  queue.report = report;

  return {
    get(...args) {
      return store.get.apply(store, args);
    },
    set(data) {
      if (!isActive()) return Promise.resolve();
      queue.unsettledWrites += 1;
      const operation = queue.current.then(async () => {
        if (!isActive()) return undefined;
        if (queue.dirty || queue.recoveryBlocked) {
          queue.dirty = true;
          queue.pendingWrites.push({
            retry: () => store.set.call(store, data),
            report,
          });
          throw Object.assign(new Error('Signal-key persistence is pending repair'), { code: 'EAGAIN' });
        }
        try {
          return await store.set.call(store, data);
        } catch (error) {
          queue.pendingWrites.push({
            retry: () => store.set.call(store, data),
            report,
          });
          queue.dirty = true;
          throw error;
        }
      }).finally(() => {
        queue.unsettledWrites = Math.max(0, queue.unsettledWrites - 1);
      });
      queue.current = operation.then(() => undefined, (error) => {
        try { report(sanitizeDiagnostic(error)); } catch {}
        return undefined;
      });
      return operation;
    },
  };
}

const KEY_WRITE_RECOVERY_TIMEOUT_MS = 10_000;

export function assertConnectAttemptActive(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Connection attempt superseded by terminal logout'), { code: 'ECANCELED' });
  }
}

export async function runConnectStage(signal, operation, { timeoutMs = CONNECT_STAGE_TIMEOUT_MS } = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  assertConnectAttemptActive(signal);
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, timeoutMs)
    : CONNECT_STAGE_TIMEOUT_MS;
  const stageController = new AbortController();
  let timeout;
  let onParentAbort;

  const result = await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signal && onParentAbort) signal.removeEventListener('abort', onParentAbort);
      handler(value);
    };
    const abortStage = (error) => {
      try { stageController.abort(); } catch {}
      settle(reject, error);
    };

    onParentAbort = () => abortStage(Object.assign(
      new Error('Connection stage cancelled by terminal shutdown'),
      { name: 'AbortError', code: 'ECANCELED' },
    ));
    if (signal?.aborted) {
      onParentAbort();
      return;
    }
    signal?.addEventListener('abort', onParentAbort, { once: true });

    timeout = setTimeout(() => abortStage(Object.assign(
      new Error('Connection stage exceeded its bounded timeout'),
      { name: 'TimeoutError', code: 'ETIMEDOUT' },
    )), boundedTimeoutMs);

    Promise.resolve().then(() => {
      assertConnectAttemptActive(signal);
      if (stageController.signal.aborted) {
        throw Object.assign(new Error('Connection stage was cancelled'), { name: 'AbortError', code: 'ECANCELED' });
      }
      return operation(stageController.signal);
    }).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    );
  });

  assertConnectAttemptActive(signal);
  return result;
}

async function waitForKeyPromise(promise, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return { timedOut: true };
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        (value) => ({ timedOut: false, value }),
        (error) => ({ timedOut: false, error }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Wait for a promise queue to settle and remain unchanged within a bounded window. */
export async function waitForPromiseQueueDrain(queue, { timeoutMs = 10_000 } = {}) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 10_000;
  const deadline = Date.now() + boundedTimeoutMs;

  while (Date.now() < deadline) {
    const observedQueue = queue.current;
    const result = await waitForKeyPromise(observedQueue, deadline);
    if (result.timedOut) return false;
    if (queue.current === observedQueue) return true;
  }
  return false;
}

async function waitForStableKeyQueue(queue, deadline) {
  while (Date.now() < deadline) {
    const observedQueue = queue.current;
    const result = await waitForKeyPromise(observedQueue, deadline);
    if (result.timedOut || result.error) return false;
    if (queue.current === observedQueue && queue.unsettledWrites === 0) return true;
  }
  return false;
}

function markKeyQueueUnhealthy(queue, error) {
  queue.dirty = true;
  queue.recoveryBlocked = true;
  try { queue.report?.(sanitizeDiagnostic(error)); } catch {}
}

async function recoverKeyWrites(queue, deadline) {
  while (Date.now() < deadline) {
    if (!(await waitForStableKeyQueue(queue, deadline))) {
      markKeyQueueUnhealthy(queue, Object.assign(
        new Error('Signal-key queue did not settle before the recovery deadline'),
        { code: 'ETIMEDOUT' },
      ));
      return false;
    }

    if (queue.pendingWrites.length === 0) {
      const observedQueue = queue.current;
      if (queue.unsettledWrites === 0 && queue.current === observedQueue) {
        queue.dirty = false;
        queue.recoveryBlocked = false;
        return true;
      }
      continue;
    }

    const pending = queue.pendingWrites[0];
    if (!pending.settlement) {
      const attempt = Promise.resolve().then(() => pending.retry());
      pending.settlement = attempt.then(
        () => {
          const index = queue.pendingWrites.indexOf(pending);
          if (index >= 0) queue.pendingWrites.splice(index, 1);
          pending.settlement = null;
          queue.dirty = queue.pendingWrites.length > 0 || queue.unsettledWrites > 0;
          return true;
        },
        (error) => {
          pending.settlement = null;
          queue.dirty = true;
          try { pending.report?.(sanitizeDiagnostic(error)); } catch {}
          return false;
        },
      );
    }

    const result = await waitForKeyPromise(pending.settlement, deadline);
    if (result.timedOut || result.error) {
      markKeyQueueUnhealthy(queue, Object.assign(
        new Error('Signal-key repair did not settle before the recovery deadline'),
        { code: 'ETIMEDOUT' },
      ));
      return false;
    }
    if (result.value !== true) return false;
  }

  markKeyQueueUnhealthy(queue, Object.assign(
    new Error('Signal-key repair exceeded its bounded recovery window'),
    { code: 'ETIMEDOUT' },
  ));
  return false;
}

/** Wait for active writes, then repair in order within a bounded recovery window. */
export async function retryFailedKeyWrites(queue, { timeoutMs = KEY_WRITE_RECOVERY_TIMEOUT_MS } = {}) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  if (!Array.isArray(queue.pendingWrites)) queue.pendingWrites = [];
  if (typeof queue.dirty !== 'boolean') queue.dirty = queue.pendingWrites.length > 0;
  if (typeof queue.recoveryBlocked !== 'boolean') queue.recoveryBlocked = queue.dirty;
  if (!Number.isSafeInteger(queue.unsettledWrites) || queue.unsettledWrites < 0) queue.unsettledWrites = 0;

  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : KEY_WRITE_RECOVERY_TIMEOUT_MS;
  const deadline = Date.now() + boundedTimeoutMs;

  if (queue.recoveryPromise) {
    const result = await waitForKeyPromise(queue.recoveryPromise, deadline);
    if (result.timedOut || result.error) {
      markKeyQueueUnhealthy(queue, Object.assign(new Error('Signal-key recovery is still in progress'), { code: 'ETIMEDOUT' }));
      return false;
    }
    return result.value === true && !queue.dirty && !queue.recoveryBlocked;
  }

  queue.recoveryBlocked = true;
  const recovery = recoverKeyWrites(queue, deadline);
  queue.recoveryPromise = recovery;
  try {
    return await recovery;
  } catch (error) {
    markKeyQueueUnhealthy(queue, error);
    return false;
  } finally {
    if (queue.recoveryPromise === recovery) queue.recoveryPromise = null;
  }
}

export function hasInFlightKeyWriteRecovery(queue) {
  return Boolean(queue?.recoveryPromise)
    || Boolean(queue?.pendingWrites?.some((pending) => pending?.settlement));
}

/** Wait for active key writes/repairs before session quarantine; never discard a live write. */
export async function waitForKeyWriteQueueDrain(queue, { timeoutMs = KEY_WRITE_RECOVERY_TIMEOUT_MS } = {}) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  if (!Array.isArray(queue.pendingWrites)) queue.pendingWrites = [];
  if (typeof queue.dirty !== 'boolean') queue.dirty = queue.pendingWrites.length > 0;
  if (typeof queue.recoveryBlocked !== 'boolean') queue.recoveryBlocked = queue.dirty;
  if (!Number.isSafeInteger(queue.unsettledWrites) || queue.unsettledWrites < 0) queue.unsettledWrites = 0;

  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : KEY_WRITE_RECOVERY_TIMEOUT_MS;
  const deadline = Date.now() + boundedTimeoutMs;
  queue.recoveryBlocked = true;

  while (Date.now() < deadline) {
    if (!(await waitForStableKeyQueue(queue, deadline))) break;

    if (queue.recoveryPromise) {
      const result = await waitForKeyPromise(queue.recoveryPromise, deadline);
      if (result.timedOut || result.error) break;
      // A recovery may have released its own gate; keep it closed until quarantine.
      queue.recoveryBlocked = true;
      continue;
    }

    const activeRepair = queue.pendingWrites.find((pending) => pending?.settlement);
    if (activeRepair) {
      const result = await waitForKeyPromise(activeRepair.settlement, deadline);
      if (result.timedOut || result.error) break;
      continue;
    }

    if (!(await waitForStableKeyQueue(queue, deadline))) break;
    if (!hasInFlightKeyWriteRecovery(queue)) return true;
  }

  markKeyQueueUnhealthy(queue, Object.assign(
    new Error('Signal-key queue did not reach a safe quarantine boundary'),
    { code: 'ETIMEDOUT' },
  ));
  return false;
}

/** Old key-store retries must not repopulate a freshly reset session directory. */
export function discardFailedKeyWritesAfterSessionReset(queue) {
  if (!queue || !queue.current || typeof queue.current.then !== 'function') {
    throw new TypeError('queue.current must be a promise');
  }
  if (hasInFlightKeyWriteRecovery(queue)) {
    throw new Error('Cannot reset the session while Signal-key recovery is in flight');
  }
  queue.pendingWrites = [];
  queue.dirty = false;
  queue.recoveryBlocked = false;
}

/**
 * Owns a single socket/reconnect timer at a time. Only explicitly identified loggedOut
 * disconnects quarantine auth; transient failures retry with capped backoff+jitter.
 */
export function createReconnectController({
  connect,
  closeSocket = async (socket) => socket?.end?.(),
  quarantine = async () => null,
  onPairingRequired = () => {},
  onDiagnostic = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
  shutdownTimeoutMs = 5_000,
} = {}) {
  if (typeof connect !== 'function') throw new TypeError('connect must be a function');
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new RangeError('shutdownTimeoutMs must be a positive finite number');
  }

  let activeSocket = null;
  let connectPromise = null;
  let connectAttempt = null;
  let transitionPromise = null;
  let transitionAction = null;
  let retryTimer = null;
  let retryCount = 0;
  let badSessionRetryCount = 0;
  let stopped = false;
  let closed = false;
  let shutdownPromise = null;
  let blockedSocket = null;
  let pendingLogout = null;
  let queuedLogoutPromise = null;
  const candidateClosePromises = new Set();
  const socketClosePromises = new WeakMap();
  const handledSockets = new WeakSet();
  const terminalLogoutSockets = new WeakSet();

  function emit(event, details = {}) {
    try { onDiagnostic(event, details); } catch {}
  }

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  }

  async function closeQuietly(socket) {
    if (!socket) return true;
    const existing = socketClosePromises.get(socket);
    if (existing) return existing;

    let resolveClose;
    const closePromise = new Promise((resolve) => { resolveClose = resolve; });
    socketClosePromises.set(socket, closePromise);
    void (async () => {
      try {
        const closedResult = await closeSocket(socket);
        if (closedResult === false) {
          blockedSocket = socket;
          emit('socket_close_failed', { errorType: 'Error' });
          resolveClose(false);
          return;
        }
        if (blockedSocket === socket) blockedSocket = null;
        resolveClose(true);
      } catch (error) {
        blockedSocket = socket;
        emit('socket_close_failed', sanitizeDiagnostic(error));
        resolveClose(false);
      }
    })();

    const closedResult = await closePromise;
    if (!closedResult && socketClosePromises.get(socket) === closePromise) {
      socketClosePromises.delete(socket);
    }
    return closedResult;
  }

  async function closeRejectedCandidate(socket) {
    if (!socket) return true;
    if (activeSocket === socket) {
      activeSocket = null;
      handledSockets.add(socket);
    }
    const closePromise = closeQuietly(socket);
    candidateClosePromises.add(closePromise);
    try {
      return await closePromise;
    } finally {
      candidateClosePromises.delete(closePromise);
    }
  }

  function scheduleRetry(reason = 'transient') {
    if (closed || stopped) return false;
    if (retryTimer !== null) return true;

    const badSessionRetry = reason === 'bad_session';
    if (badSessionRetry && badSessionRetryCount >= MAX_BAD_SESSION_RETRIES) {
      stopped = true;
      clearRetryTimer();
      emit('reconnect_stopped', {
        errorType: 'Error',
        statusCode: BAD_SESSION_STATUS_CODE,
        reason: 'bad_session_retry_limit',
        retryLimit: MAX_BAD_SESSION_RETRIES,
      });
      return false;
    }

    const delayMs = calculateRetryDelay(retryCount, { baseDelayMs, maxDelayMs, random });
    retryCount += 1;
    if (badSessionRetry) badSessionRetryCount += 1;
    emit('retry_scheduled', {
      attempt: retryCount,
      ...(badSessionRetry ? {
        statusCode: BAD_SESSION_STATUS_CODE,
        badSessionAttempt: badSessionRetryCount,
        retryLimit: MAX_BAD_SESSION_RETRIES,
      } : {}),
      delayMs,
      reason,
    });
    retryTimer = setTimer(() => {
      retryTimer = null;
      void connectNow();
    }, delayMs);
    return true;
  }

  async function performFailure(socket, error, { explicitLogout = false, forceRetry = false } = {}) {
    if (closed) return false;
    const action = explicitLogout ? 'logout' : forceRetry ? 'retry' : classifyDisconnect(error);
    const targetSocket = socket || activeSocket;
    let confirmedLogoutSocket = null;
    if (targetSocket) {
      if (action === 'logout' && handledSockets.has(targetSocket)) {
        if (terminalLogoutSockets.has(targetSocket)) return false;
        if (blockedSocket === targetSocket && !(await closeQuietly(targetSocket))) {
          stopped = true;
          clearRetryTimer();
          return false;
        }
        confirmedLogoutSocket = targetSocket;
      } else {
        if (targetSocket !== activeSocket || handledSockets.has(targetSocket)) return false;
        handledSockets.add(targetSocket);
        activeSocket = null;
        if (!(await closeQuietly(targetSocket))) {
          stopped = true;
          clearRetryTimer();
          return false;
        }
        if (action === 'logout') confirmedLogoutSocket = targetSocket;
      }
      if (action === 'logout' && activeSocket && activeSocket !== targetSocket) {
        const otherSocket = activeSocket;
        handledSockets.add(otherSocket);
        activeSocket = null;
        if (!(await closeQuietly(otherSocket))) {
          stopped = true;
          clearRetryTimer();
          return false;
        }
      }
    }

    if (blockedSocket) {
      const socketAwaitingClose = blockedSocket;
      if (!(await closeQuietly(socketAwaitingClose))) {
        stopped = true;
        clearRetryTimer();
        return false;
      }
    }

    if (closed) return false;
    if (pendingLogout && action !== 'logout') return false;

    if (action === 'logout') {
      if (confirmedLogoutSocket) terminalLogoutSockets.add(confirmedLogoutSocket);
      stopped = false;
      clearRetryTimer();
      if (!explicitLogout) emit('logout_confirmed', { statusCode: 401 });
      let quarantinedSession;
      try {
        quarantinedSession = await quarantine();
      } catch (quarantineError) {
        stopped = true;
        clearRetryTimer();
        emit('session_quarantine_failed', sanitizeDiagnostic(quarantineError));
        return false;
      }

      if (quarantinedSession) emit('session_quarantined', { statusCode: 401 });
      if (closed) {
        stopped = true;
        clearRetryTimer();
        return false;
      }
      try { onPairingRequired(); } catch {}
      retryCount = 0;
      return scheduleRetry('pairing');
    }

    if (action === 'retry') {
      if (statusCodeOf(error) === BAD_SESSION_STATUS_CODE) return scheduleRetry('bad_session');
      return scheduleRetry('transient');
    }

    stopped = true;
    clearRetryTimer();
    emit('reconnect_stopped', sanitizeDiagnostic(error));
    return false;
  }

  function runTransition(socket, error, options = {}) {
    transitionAction = options.explicitLogout
      ? 'logout'
      : options.forceRetry
        ? 'retry'
        : classifyDisconnect(error);
    transitionPromise = performFailure(socket, error, options).finally(() => {
      transitionPromise = null;
      transitionAction = null;
    });
    return transitionPromise;
  }

  function queuePriorityLogout(socket, error, options, { connectSettled = false } = {}) {
    if (queuedLogoutPromise) return queuedLogoutPromise;
    pendingLogout = { socket, error, options };
    clearRetryTimer();
    if (connectAttempt && !connectAttempt.controller.signal.aborted) {
      connectAttempt.controller.abort();
    }
    const activeWork = [transitionPromise, connectSettled ? null : connectPromise].filter(Boolean);
    queuedLogoutPromise = Promise.allSettled(activeWork).then(() => {
      const request = pendingLogout;
      pendingLogout = null;
      if (!request || closed) return false;
      clearRetryTimer();
      stopped = false;
      // The in-flight transition already retired the socket; retain its identity
      // so this terminal event can win exactly once without closing it twice.
      return runTransition(request.socket, request.error, request.options);
    }).finally(() => {
      queuedLogoutPromise = null;
    });
    return queuedLogoutPromise;
  }

  function handleFailure(socket, error, options = {}) {
    if (closed) {
      if (socket) void closeRejectedCandidate(socket);
      return Promise.resolve(false);
    }
    const terminalLogout = options.explicitLogout
      || (!options.forceRetry && classifyDisconnect(error) === 'logout');
    if (terminalLogout && connectAttempt && !connectAttempt.controller.signal.aborted) {
      clearRetryTimer();
      connectAttempt.controller.abort();
    }
    if (queuedLogoutPromise) return queuedLogoutPromise;
    if (transitionPromise) {
      if (terminalLogout && transitionAction !== 'logout') {
        return queuePriorityLogout(socket, error, options, {
          connectSettled: options.connectAttempt === connectAttempt,
        });
      }
      return transitionPromise;
    }
    if (terminalLogout && connectPromise) {
      return queuePriorityLogout(socket, error, options, {
        connectSettled: options.connectAttempt === connectAttempt,
      });
    }
    return runTransition(socket, error, options);
  }

  function registerSocket(socket, attempt = null) {
    if (!socket) return false;
    if (closed || (attempt && (attempt.controller.signal.aborted || connectAttempt !== attempt))) {
      void closeRejectedCandidate(socket);
      return false;
    }
    if (stopped || blockedSocket) {
      void closeRejectedCandidate(socket);
      return false;
    }
    if (activeSocket && activeSocket !== socket) {
      handledSockets.add(socket);
      void closeRejectedCandidate(socket).then((socketClosed) => {
        if (!socketClosed) {
          stopped = true;
          clearRetryTimer();
        }
      });
      emit('overlapping_socket_prevented', {});
      return false;
    }
    if (handledSockets.has(socket)) return false;
    activeSocket = socket;
    return true;
  }

  function connectNow() {
    if (closed) return Promise.resolve(null);
    if (pendingLogout || queuedLogoutPromise) return Promise.resolve(null);
    if (stopped || blockedSocket) return Promise.resolve(null);
    if (activeSocket) return Promise.resolve(activeSocket);
    if (transitionPromise || retryTimer !== null) return Promise.resolve(null);
    if (connectPromise) return connectPromise;

    const attempt = { controller: new AbortController() };
    connectAttempt = attempt;
    const registerCandidate = (socket) => registerSocket(socket, attempt);
    let resolveConnectPromise;
    connectPromise = new Promise((resolve) => { resolveConnectPromise = resolve; });
    const trackedConnectPromise = connectPromise;
    const connectWork = (async () => {
      let candidateSocket = null;
      try {
        candidateSocket = await connect(registerCandidate, {
          signal: attempt.controller.signal,
          closeCandidate: closeRejectedCandidate,
        });
        if (closed || attempt.controller.signal.aborted || connectAttempt !== attempt) {
          await closeRejectedCandidate(candidateSocket);
          return null;
        }
        if (!candidateSocket) return null;
        if (!activeSocket && !handledSockets.has(candidateSocket)) registerSocket(candidateSocket, attempt);
        return activeSocket === candidateSocket ? candidateSocket : null;
      } catch (error) {
        if (closed || attempt.controller.signal.aborted || connectAttempt !== attempt) {
          await closeRejectedCandidate(candidateSocket);
          return null;
        }
        const failedSocket = candidateSocket && activeSocket === candidateSocket
          ? candidateSocket
          : null;
        await handleFailure(failedSocket, error, { connectAttempt: attempt });
        return null;
      } finally {
        if (connectAttempt === attempt) connectAttempt = null;
      }
    })();
    void connectWork.then((result) => {
      if (connectPromise === trackedConnectPromise) connectPromise = null;
      resolveConnectPromise(result);
    }, (error) => {
      if (connectAttempt === attempt) connectAttempt = null;
      if (connectPromise === trackedConnectPromise) connectPromise = null;
      emit('connect_attempt_failed', sanitizeDiagnostic(error));
      resolveConnectPromise(null);
    });
    return trackedConnectPromise;
  }

  function waitForPromisesUntil(promises, deadline) {
    const pending = [...new Set(promises)].filter(Boolean);
    if (pending.length === 0) return Promise.resolve(true);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return Promise.resolve(false);

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), remainingMs);
      Promise.allSettled(pending).then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async function waitForShutdownWork(deadline) {
    while (true) {
      const pending = [transitionPromise, queuedLogoutPromise, connectPromise, ...candidateClosePromises]
        .filter(Boolean);
      if (pending.length === 0) return true;
      if (!(await waitForPromisesUntil(pending, deadline))) return false;
    }
  }

  async function closeRemainingSockets(deadline) {
    const sockets = new Set([activeSocket, blockedSocket].filter(Boolean));
    for (const socket of sockets) {
      if (activeSocket === socket) {
        activeSocket = null;
        handledSockets.add(socket);
      }
    }
    const closePromises = [...sockets].map((socket) => closeQuietly(socket));
    if (!(await waitForPromisesUntil(closePromises, deadline))) return false;
    return (await Promise.all(closePromises)).every(Boolean);
  }

  return {
    connect: connectNow,
    getSocket: () => activeSocket,
    getRetryCount: () => retryCount,
    markOpen(socket) {
      if (socket !== activeSocket) return false;
      retryCount = 0;
      // Only a successful connection.open ends a consecutive badSession failure episode.
      badSessionRetryCount = 0;
      return true;
    },
    handleDisconnect(socket, error) {
      return handleFailure(socket, error, { forceRetry: error == null });
    },
    handleSocketError(socket, error) {
      const action = classifyDisconnect(error);
      if (action === 'stop') emit('socket_error', sanitizeDiagnostic(error));
      // Even an unfamiliar WebSocket error invalidates that socket; recover with
      // auth preserved instead of leaving a stale socket registered as active.
      return handleFailure(socket, error, { forceRetry: action === 'stop' });
    },
    logout() {
      clearRetryTimer();
      return handleFailure(activeSocket, null, { explicitLogout: true });
    },
    async resume() {
      if (closed) return null;
      if (blockedSocket) {
        const socketAwaitingClose = blockedSocket;
        if (!(await closeQuietly(socketAwaitingClose))) return null;
      }
      stopped = false;
      clearRetryTimer();
      return connectNow();
    },
    close() {
      if (shutdownPromise) return shutdownPromise;
      closed = true;
      stopped = true;
      clearRetryTimer();
      shutdownPromise = (async () => {
        // Let the promise be stored before abort listeners can re-enter close().
        await Promise.resolve();
        if (connectAttempt && !connectAttempt.controller.signal.aborted) {
          try { connectAttempt.controller.abort(); } catch {}
        }
        const deadline = Date.now() + shutdownTimeoutMs;
        const workDrained = await waitForShutdownWork(deadline);
        const socketsClosed = await closeRemainingSockets(deadline);
        const lateWorkDrained = await waitForShutdownWork(deadline);
        const complete = workDrained && socketsClosed && lateWorkDrained;
        if (!complete) emit('controller_close_incomplete', { timeoutMs: shutdownTimeoutMs });
        return complete;
      })();
      return shutdownPromise;
    },
  };
}
