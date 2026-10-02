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

export function classifyDisconnect(error) {
  const statusCode = statusCodeOf(error);

  // A numeric 401 alone is ambiguous; quarantine only a clearly identified terminal logout.
  if (statusCode === 401 && hasExplicitLoggedOutReason(error)) return 'logout';
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

  return {
    get(...args) {
      return store.get.apply(store, args);
    },
    set(data) {
      if (!isActive()) return Promise.resolve();
      const operation = queue.current.then(() => {
        if (!isActive()) return undefined;
        return store.set.call(store, data);
      });
      queue.current = operation.then(() => undefined, (error) => {
        try { report(sanitizeDiagnostic(error)); } catch {}
        return undefined;
      });
      return operation;
    },
  };
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
  let retryTimer = null;
  let retryCount = 0;
  let stopped = false;
  const handledSockets = new WeakSet();

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
    if (!socket) return;
    try {
      await closeSocket(socket);
    } catch (error) {
      emit('socket_close_failed', sanitizeDiagnostic(error));
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
    const targetSocket = socket || activeSocket;
    if (targetSocket) {
      if (targetSocket !== activeSocket || handledSockets.has(targetSocket)) return false;
      handledSockets.add(targetSocket);
      activeSocket = null;
      await closeQuietly(targetSocket);
    }

    const action = explicitLogout ? 'logout' : forceRetry ? 'retry' : classifyDisconnect(error);
    if (action === 'logout') {
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

  function handleFailure(socket, error, options = {}) {
    if (transitionPromise) return transitionPromise;
    transitionPromise = performFailure(socket, error, options).finally(() => {
      transitionPromise = null;
    });
    return transitionPromise;
  }

  function registerSocket(socket) {
    if (!socket || stopped) {
      void closeQuietly(socket);
      return false;
    }
    if (activeSocket && activeSocket !== socket) {
      handledSockets.add(socket);
      void closeQuietly(socket);
      emit('overlapping_socket_prevented', {});
      return false;
    }
    if (handledSockets.has(socket)) return false;
    activeSocket = socket;
    return true;
  }

  function connectNow() {
    if (stopped) return Promise.resolve(null);
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
      stopped = false;
      clearRetryTimer();
      const currentTransition = transitionPromise;
      if (currentTransition) {
        return currentTransition.then(() => handleFailure(activeSocket, null, { explicitLogout: true }));
      }
      return handleFailure(activeSocket, null, { explicitLogout: true });
    },
    resume() {
      stopped = false;
      clearRetryTimer();
      return connectNow();
    },
    async close() {
      stopped = true;
      clearRetryTimer();
      const socket = activeSocket;
      if (socket && !handledSockets.has(socket)) {
        handledSockets.add(socket);
        activeSocket = null;
        await closeQuietly(socket);
      }
    },
  };
}
