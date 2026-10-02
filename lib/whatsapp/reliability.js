import fs from 'node:fs';
import path from 'node:path';

const RETRYABLE_STATUS_CODES = new Set([405, 408, 428, 503, 515]);
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
} = {}) {
  if (typeof connect !== 'function') throw new TypeError('connect must be a function');

  let activeSocket = null;
  let connectPromise = null;
  let transitionPromise = null;
  let transitionAction = null;
  let retryTimer = null;
  let retryCount = 0;
  let stopped = false;
  let blockedSocket = null;
  let pendingLogout = null;
  let queuedLogoutPromise = null;
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
    try {
      const closed = await closeSocket(socket);
      if (closed === false) {
        blockedSocket = socket;
        emit('socket_close_failed', { errorType: 'Error' });
        return false;
      }
      if (blockedSocket === socket) blockedSocket = null;
      return true;
    } catch (error) {
      blockedSocket = socket;
      emit('socket_close_failed', sanitizeDiagnostic(error));
      return false;
    }
  }

  function scheduleRetry(reason = 'transient') {
    if (stopped) return false;
    if (retryTimer !== null) return true;

    const delayMs = calculateRetryDelay(retryCount, { baseDelayMs, maxDelayMs, random });
    retryCount += 1;
    emit('retry_scheduled', { attempt: retryCount, delayMs, reason });
    retryTimer = setTimer(() => {
      retryTimer = null;
      void connectNow();
    }, delayMs);
    return true;
  }

  async function performFailure(socket, error, { explicitLogout = false, forceRetry = false } = {}) {
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

      try { onPairingRequired(); } catch {}
      retryCount = 0;
      if (quarantinedSession) emit('session_quarantined', { statusCode: 401 });
      return scheduleRetry('pairing');
    }

    if (action === 'retry') return scheduleRetry('transient');

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

  function queuePriorityLogout(socket, error, options) {
    if (queuedLogoutPromise) return queuedLogoutPromise;
    pendingLogout = { socket, error, options };
    const activeTransition = transitionPromise || Promise.resolve();
    queuedLogoutPromise = activeTransition.then(() => {
      const request = pendingLogout;
      pendingLogout = null;
      if (!request) return false;
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
    if (queuedLogoutPromise) return queuedLogoutPromise;
    const terminalLogout = options.explicitLogout
      || (!options.forceRetry && classifyDisconnect(error) === 'logout');
    if (transitionPromise) {
      if (terminalLogout && transitionAction !== 'logout') {
        return queuePriorityLogout(socket, error, options);
      }
      return transitionPromise;
    }
    return runTransition(socket, error, options);
  }

  function registerSocket(socket) {
    if (!socket || stopped || blockedSocket) {
      void closeQuietly(socket);
      return false;
    }
    if (activeSocket && activeSocket !== socket) {
      handledSockets.add(socket);
      void closeQuietly(socket).then((closed) => {
        if (!closed) {
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
    if (stopped || blockedSocket) return Promise.resolve(null);
    if (activeSocket) return Promise.resolve(activeSocket);
    if (transitionPromise || retryTimer !== null) return Promise.resolve(null);
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
      let candidateSocket = null;
      try {
        candidateSocket = await connect(registerSocket);
        if (!candidateSocket) return null;
        if (!activeSocket && !handledSockets.has(candidateSocket)) registerSocket(candidateSocket);
        return activeSocket === candidateSocket ? candidateSocket : null;
      } catch (error) {
        const failedSocket = candidateSocket && activeSocket === candidateSocket
          ? candidateSocket
          : null;
        await handleFailure(failedSocket, error);
        return null;
      } finally {
        connectPromise = null;
      }
    })();

    return connectPromise;
  }

  return {
    connect: connectNow,
    getSocket: () => activeSocket,
    getRetryCount: () => retryCount,
    markOpen(socket) {
      if (socket !== activeSocket) return false;
      retryCount = 0;
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
      if (blockedSocket) {
        const socketAwaitingClose = blockedSocket;
        if (!(await closeQuietly(socketAwaitingClose))) return null;
      }
      stopped = false;
      clearRetryTimer();
      return connectNow();
    },
    async close() {
      stopped = true;
      clearRetryTimer();
      const inFlight = [transitionPromise, queuedLogoutPromise].filter(Boolean);
      if (inFlight.length > 0) await Promise.allSettled(inFlight);
      stopped = true;
      clearRetryTimer();
      const socket = activeSocket;
      let activeSocketClosed = true;
      if (socket && !handledSockets.has(socket)) {
        handledSockets.add(socket);
        activeSocket = null;
        activeSocketClosed = await closeQuietly(socket);
      }
      if (blockedSocket) {
        const blockedSocketClosed = await closeQuietly(blockedSocket);
        return activeSocketClosed && blockedSocketClosed;
      }
      return activeSocketClosed;
    },
  };
}
