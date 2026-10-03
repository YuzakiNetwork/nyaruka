const FAILURE_HEADER = 'Failed to decrypt message with any known session...';
const BAD_MAC_SESSION_ERROR = 'Session error:Error: Bad MAC';
const SUMMARY_MESSAGE = 'Repeated libsignal Bad MAC decrypt diagnostics suppressed';
const DEFAULT_SUMMARY_INTERVAL_MS = 60_000;

function isFailureHeader(args) {
  return args.length === 1 && args[0] === FAILURE_HEADER;
}

function isBadMacSessionError(args) {
  if (args.length !== 2 || args[0] !== BAD_MAC_SESSION_ERROR || typeof args[1] !== 'string') {
    return false;
  }

  const stackLines = args[1].split(/\r?\n/);
  return stackLines[0] === 'Error: Bad MAC'
    && stackLines.some(line => /[\\/]libsignal[\\/]src[\\/]crypto\.js:\d+(?::\d+)?/.test(line))
    && stackLines.some(line => /[\\/]libsignal[\\/]src[\\/]session_cipher\.js:\d+(?::\d+)?/.test(line));
}

function countMatchingBursts(entries) {
  let index = 0;
  let count = 0;

  while (index < entries.length) {
    if (!isFailureHeader(entries[index])) return 0;
    index += 1;

    let stackCount = 0;
    while (index < entries.length && isBadMacSessionError(entries[index])) {
      stackCount += 1;
      index += 1;
    }
    if (stackCount === 0) return 0;
    count += 1;
  }

  return count;
}

/**
 * Suppress only libsignal's known multi-call Bad MAC diagnostic batch. If the
 * dependency changes either its message or stack shape, calls pass through.
 */
export function installLibsignalBadMacLogDeduper({
  consoleObject = console,
  logger,
  summaryIntervalMs = DEFAULT_SUMMARY_INTERVAL_MS,
  setImmediateFn = callback => setImmediate(callback),
  setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
  clearTimeoutFn = timer => clearTimeout(timer),
} = {}) {
  if (typeof consoleObject?.error !== 'function') {
    throw new TypeError('consoleObject must provide error');
  }
  if (typeof logger?.warn !== 'function') {
    throw new TypeError('logger must provide warn');
  }
  if (!Number.isFinite(summaryIntervalMs) || summaryIntervalMs <= 0) {
    throw new RangeError('summaryIntervalMs must be a positive finite number');
  }
  if (typeof setImmediateFn !== 'function' || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('timer functions must be callable');
  }

  const originalError = consoleObject.error;
  let pendingEntries = null;
  let summaryTimer = null;
  let suppressedSinceSummary = 0;
  let disposed = false;

  function emitSummary(count) {
    try {
      logger.warn({ count }, SUMMARY_MESSAGE);
    } catch {
      // Diagnostic reporting must never interfere with message processing.
    }
  }

  function recordSuppressed(count) {
    if (summaryTimer) {
      suppressedSinceSummary += count;
      return;
    }

    emitSummary(count);
    summaryTimer = setTimeoutFn(() => {
      summaryTimer = null;
      const pendingCount = suppressedSinceSummary;
      suppressedSinceSummary = 0;
      if (pendingCount > 0) emitSummary(pendingCount);
    }, summaryIntervalMs);
    summaryTimer?.unref?.();
  }

  function flushPendingEntries() {
    const entries = pendingEntries;
    pendingEntries = null;
    if (!entries) return;

    const matchedCount = countMatchingBursts(entries);
    if (matchedCount > 0) {
      recordSuppressed(matchedCount);
      return;
    }

    for (const args of entries) originalError.apply(consoleObject, args);
  }

  function wrappedError(...args) {
    if (disposed) return originalError.apply(consoleObject, args);

    if (pendingEntries) {
      pendingEntries.push(args);
      return;
    }

    if (isFailureHeader(args)) {
      pendingEntries = [args];
      setImmediateFn(flushPendingEntries);
      return;
    }

    return originalError.apply(consoleObject, args);
  }

  consoleObject.error = wrappedError;

  return function dispose() {
    if (disposed) return;
    disposed = true;
    if (consoleObject.error === wrappedError) consoleObject.error = originalError;
    flushPendingEntries();
    if (summaryTimer) clearTimeoutFn(summaryTimer);
    summaryTimer = null;
    if (suppressedSinceSummary > 0) {
      const pendingCount = suppressedSinceSummary;
      suppressedSinceSummary = 0;
      emitSummary(pendingCount);
    }
  };
}
