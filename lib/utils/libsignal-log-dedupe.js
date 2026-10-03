const FAILURE_HEADER = 'Failed to decrypt message with any known session...';
const BAD_MAC_SESSION_ERROR = 'Session error:Error: Bad MAC';
const SUMMARY_MESSAGE = 'libsignal Bad MAC decrypt diagnostics suppressed';
const DEFAULT_SUMMARY_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BUFFERED_ENTRIES = 32;
const DEFAULT_MAX_BUFFERED_ARGS = 64;
const DEFAULT_MAX_BUFFERED_STRING_CHARS = 64 * 1024;

function isFailureHeader(args) {
  return args.length === 1 && args[0] === FAILURE_HEADER;
}

function isBadMacSessionError(args) {
  if (args.length !== 2 || args[0] !== BAD_MAC_SESSION_ERROR || typeof args[1] !== 'string') {
    return false;
  }

  const stackLines = args[1].split(/\r?\n/);
  const hasExactBadMacFrames = stackLines[1]
    && /^    at Object\.verifyMAC \(.*[\\/]libsignal[\\/]src[\\/]crypto\.js:87:\d+\)$/.test(stackLines[1])
    && stackLines[2]
    && /^    at SessionCipher\.doDecryptWhisperMessage \(.*[\\/]libsignal[\\/]src[\\/]session_cipher\.js:250:\d+\)$/.test(stackLines[2]);
  const libsignalFrameCount = stackLines
    .slice(1)
    .filter(line => /[\\/]libsignal[\\/]src[\\/]/.test(line))
    .length;

  // This fingerprint is intentionally tied to the pinned upstream source. Any
  // changed wording, frame order, source line, or added libsignal frame fails open.
  return stackLines[0] === 'Error: Bad MAC'
    && hasExactBadMacFrames
    && libsignalFrameCount === 2;
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

function elapsedMilliseconds(startedAt, now) {
  const elapsed = now - startedAt;
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
}

function stringCharacters(args) {
  return args.reduce((total, arg) => total + (typeof arg === 'string' ? arg.length : 0), 0);
}

/**
 * Suppress only complete libsignal Bad MAC diagnostic batches. If the pinned
 * dependency's message or stack changes, every captured console call is replayed.
 */
export function installLibsignalBadMacLogDeduper({
  consoleObject = console,
  logger,
  summaryIntervalMs = DEFAULT_SUMMARY_INTERVAL_MS,
  maxBufferedEntries = DEFAULT_MAX_BUFFERED_ENTRIES,
  maxBufferedArgs = DEFAULT_MAX_BUFFERED_ARGS,
  maxBufferedStringChars = DEFAULT_MAX_BUFFERED_STRING_CHARS,
  nowFn = () => Number(process.hrtime.bigint()) / 1_000_000,
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
  for (const [name, value] of Object.entries({ maxBufferedEntries, maxBufferedArgs, maxBufferedStringChars })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  if (typeof nowFn !== 'function') {
    throw new TypeError('nowFn must be callable');
  }
  if (typeof setImmediateFn !== 'function' || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('timer functions must be callable');
  }

  const originalError = consoleObject.error;
  let pendingEntries = null;
  let pendingArgCount = 0;
  let pendingStringChars = 0;
  let summaryTimer = null;
  let suppressedCount = 0;
  let windowStartedAt = null;
  let disposed = false;

  function emitSummary(count, elapsedMs) {
    try {
      logger.warn({ count, elapsedMs }, SUMMARY_MESSAGE);
    } catch {
      // Diagnostic reporting must never interfere with message processing.
    }
  }

  function flushSuppressedSummary() {
    summaryTimer = null;
    if (suppressedCount === 0 || windowStartedAt === null) return;

    const count = suppressedCount;
    const elapsedMs = elapsedMilliseconds(windowStartedAt, nowFn());
    suppressedCount = 0;
    windowStartedAt = null;
    emitSummary(count, elapsedMs);
  }

  function recordSuppressed(count) {
    if (suppressedCount === 0) windowStartedAt = nowFn();
    suppressedCount += count;
    if (summaryTimer) return;

    summaryTimer = setTimeoutFn(flushSuppressedSummary, summaryIntervalMs);
    summaryTimer?.unref?.();
  }

  function takePendingEntries(expectedEntries) {
    if (!pendingEntries || (expectedEntries && pendingEntries !== expectedEntries)) return null;
    const entries = pendingEntries;
    pendingEntries = null;
    pendingArgCount = 0;
    pendingStringChars = 0;
    return entries;
  }

  function replayEntries(entries) {
    let firstError;
    for (const args of entries || []) {
      try {
        originalError.apply(consoleObject, args);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  function replayCandidateWithCurrent(currentArgs) {
    let firstError;
    try {
      replayEntries(takePendingEntries());
    } catch (error) {
      firstError = error;
    }
    try {
      originalError.apply(consoleObject, currentArgs);
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }

  function exceedsBufferLimits(args) {
    return (pendingEntries?.length ?? 0) + 1 > maxBufferedEntries
      || pendingArgCount + args.length > maxBufferedArgs
      || pendingStringChars + stringCharacters(args) > maxBufferedStringChars;
  }

  function schedulePendingFlush() {
    const candidate = pendingEntries;
    try {
      setImmediateFn(() => flushPendingEntries(candidate));
    } catch {
      replayEntries(takePendingEntries(candidate));
    }
  }

  function flushPendingEntries(expectedEntries) {
    const entries = takePendingEntries(expectedEntries);
    if (!entries) return;

    const matchedCount = countMatchingBursts(entries);
    if (matchedCount > 0) {
      recordSuppressed(matchedCount);
      return;
    }

    replayEntries(entries);
  }

  function wrappedError(...args) {
    if (disposed) return originalError.apply(consoleObject, args);

    if (pendingEntries) {
      if (exceedsBufferLimits(args)) {
        // A capped or incomplete candidate is never partially suppressed.
        replayCandidateWithCurrent(args);
        return;
      }
      pendingEntries.push(args);
      pendingArgCount += args.length;
      pendingStringChars += stringCharacters(args);
      return;
    }

    if (isFailureHeader(args)) {
      if (exceedsBufferLimits(args)) {
        return originalError.apply(consoleObject, args);
      }
      pendingEntries = [args];
      pendingArgCount = args.length;
      pendingStringChars = stringCharacters(args);
      schedulePendingFlush();
      return;
    }

    return originalError.apply(consoleObject, args);
  }

  consoleObject.error = wrappedError;

  return function dispose() {
    if (disposed) return;
    disposed = true;
    if (consoleObject.error === wrappedError) consoleObject.error = originalError;

    let firstError;
    try {
      flushPendingEntries();
    } catch (error) {
      firstError = error;
    }
    if (summaryTimer) {
      try {
        clearTimeoutFn(summaryTimer);
      } catch (error) {
        firstError ??= error;
      }
      summaryTimer = null;
    }
    try {
      flushSuppressedSummary();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  };
}
