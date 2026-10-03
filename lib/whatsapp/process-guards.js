import { sanitizeDiagnostic } from './reliability.js';

export function createShutdownCleanup({ dispose = async () => {}, close = async () => {} } = {}) {
  if (typeof dispose !== 'function') throw new TypeError('dispose must be a function');
  if (typeof close !== 'function') throw new TypeError('close must be a function');

  let cleanupPromise = null;
  return function cleanupOnce() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      let firstError;
      try {
        await dispose();
      } catch (error) {
        firstError = error;
      }
      let closeResult;
      try {
        closeResult = await close();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError) throw firstError;
      return closeResult;
    })();
    return cleanupPromise;
  };
}

export function installShutdownSignalHandlers({ processObject = process, logger, cleanup } = {}) {
  if (typeof processObject?.on !== 'function' || typeof processObject?.off !== 'function') {
    throw new TypeError('processObject must provide on and off');
  }
  if (typeof processObject.exit !== 'function') throw new TypeError('processObject must provide exit');
  if (typeof logger?.info !== 'function' || typeof logger?.error !== 'function') {
    throw new TypeError('logger must provide info and error');
  }
  if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');

  let shutdownPromise = null;
  function handleSignal(signal) {
    if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
      throw new TypeError('signal must be SIGINT or SIGTERM');
    }
    if (shutdownPromise) return shutdownPromise;

    try {
      logger.info({ signal }, 'Shutdown signal received; closing resources');
    } catch {}

    shutdownPromise = (async () => {
      let exitCode = signal === 'SIGINT' ? 130 : 143;
      try {
        const cleanupComplete = await cleanup();
        if (cleanupComplete === false) {
          try { logger.error({}, 'Shutdown cleanup incomplete; process is exiting'); } catch {}
        }
      } catch (error) {
        exitCode = 1;
        try { logger.error(sanitizeDiagnostic(error), 'Shutdown cleanup failed'); } catch {}
      }
      processObject.exit(exitCode);
    })();
    return shutdownPromise;
  }

  const onSigint = () => { void handleSignal('SIGINT').catch(() => {}); };
  const onSigterm = () => { void handleSignal('SIGTERM').catch(() => {}); };
  processObject.on('SIGINT', onSigint);
  processObject.on('SIGTERM', onSigterm);

  return {
    handleSignal,
    dispose() {
      processObject.off('SIGINT', onSigint);
      processObject.off('SIGTERM', onSigterm);
    },
  };
}

export function installFatalProcessHandlers({
  processObject = process,
  logger,
  cleanup = async () => {},
} = {}) {
  if (typeof processObject?.on !== 'function' || typeof processObject?.off !== 'function') {
    throw new TypeError('processObject must provide on and off');
  }
  if (typeof processObject.exit !== 'function') throw new TypeError('processObject must provide exit');
  if (typeof logger?.fatal !== 'function' || typeof logger?.error !== 'function') {
    throw new TypeError('logger must provide fatal and error');
  }
  if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');

  let handling = false;
  let shutdownPromise = null;

  function handleFatalError(error, event) {
    if (handling) return shutdownPromise || Promise.resolve();
    handling = true;
    const isRejection = event === 'unhandledRejection';
    try {
      logger.fatal(
        sanitizeDiagnostic(error),
        isRejection
          ? 'Unhandled promise rejection; shutting down after cleanup'
          : 'Uncaught exception; shutting down after cleanup',
      );
    } catch {}

    shutdownPromise = (async () => {
      try {
        const cleanupComplete = await cleanup();
        if (cleanupComplete === false) {
          try { logger.error({}, 'Fatal shutdown cleanup incomplete; controller remains closed to late resources'); } catch {}
        }
      } catch (cleanupError) {
        try { logger.error(sanitizeDiagnostic(cleanupError), 'Fatal shutdown cleanup failed'); } catch {}
      }
      processObject.exit(1);
    })();
    return shutdownPromise;
  }

  const onUnhandledRejection = (reason) => {
    void handleFatalError(reason, 'unhandledRejection').catch(() => {});
  };
  const onUncaughtException = (error) => {
    void handleFatalError(error, 'uncaughtException').catch(() => {});
  };
  processObject.on('unhandledRejection', onUnhandledRejection);
  processObject.on('uncaughtException', onUncaughtException);

  return {
    handleFatalError,
    dispose() {
      processObject.off('unhandledRejection', onUnhandledRejection);
      processObject.off('uncaughtException', onUncaughtException);
    },
  };
}
