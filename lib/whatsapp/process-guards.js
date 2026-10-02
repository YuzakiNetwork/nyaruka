import { sanitizeDiagnostic } from './reliability.js';

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
        await cleanup();
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
