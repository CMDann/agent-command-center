import pino from 'pino';
import { mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = '.nexus';
const LOG_FILE = join(LOG_DIR, 'nexus.log');

// Ensure the runtime directory exists before opening the log file.
mkdirSync(LOG_DIR, { recursive: true });

/**
 * Shared structured logger for all NEXUS modules.
 *
 * Writes exclusively to `.nexus/nexus.log` — never to stdout — so that
 * log output does not corrupt the Ink TUI render.
 *
 * Usage:
 * ```ts
 * import { logger } from '../utils/logger.js';
 * logger.info({ agentId, host }, 'Agent connected');
 * ```
 */
export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'debug',
    // Redact common secret patterns before they reach disk.
    redact: {
      paths: ['token', 'secret', 'password', 'authorization'],
      censor: '[REDACTED]',
    },
  },
  pino.destination({ dest: LOG_FILE, sync: false })
);
