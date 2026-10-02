/**
 * lib/utils/logger.js
 * Pino logger — pretty in dev, JSON in production.
 */

import pino from 'pino';
import { config } from '../../config.js';

const REDACTION_PATHS = Object.freeze([
  'code',
  'pairingCode',
  'pairing_code',
  '*.pairingCode',
  '*.pairing_code',
]);

export function createLogger({ level = config.log.level, pretty = process.env.NODE_ENV !== 'production' } = {}, destination) {
  return pino({
    level,
    redact: { paths: [...REDACTION_PATHS], censor: '[REDACTED]' },
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  }, destination);
}

export const logger = createLogger();

export default logger;
