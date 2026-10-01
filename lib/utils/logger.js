/**
 * lib/utils/logger.js
 * Pino logger — pretty in dev, JSON in production.
 */

import pino from 'pino';
import { config } from '../../config.js';

export const logger = pino({
  level: config.log.level,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

export default logger;
