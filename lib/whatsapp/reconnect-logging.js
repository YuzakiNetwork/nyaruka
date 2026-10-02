export function logReconnectDiagnostic(logger, event, details = {}) {
  if (event === 'retry_scheduled') {
    if (details.reason === 'pairing') {
      logger.info(details, 'Pairing reconnection scheduled');
    } else {
      logger.warn(details, '⚠️ Koneksi WhatsApp terputus. Nyaruka mencoba menyambung kembali; sesi tetap disimpan.');
    }
    return;
  }

  if (event === 'logout_confirmed') {
    logger.warn(details, '🔐 WhatsApp melaporkan sesi telah keluar. Pairing ulang diperlukan untuk menyambungkan kembali.');
    return;
  }

  if (event === 'session_quarantined') {
    logger.info(details, '🧹 Sesi lokal sudah direset. Pairing ulang diperlukan.');
    return;
  }

  if (event === 'session_quarantine_failed') {
    logger.error(details, 'Could not quarantine auth state; reconnect stopped to preserve it');
    return;
  }

  if (event === 'reconnect_stopped') {
    logger.error(details, 'Reconnect stopped for a non-retryable disconnect; auth state preserved');
    return;
  }

  logger.warn({ event, ...details }, 'WhatsApp connection diagnostic');
}
