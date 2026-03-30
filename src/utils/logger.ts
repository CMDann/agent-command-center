import pino from 'pino';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sanitizeLogObject } from './sanitize.js';

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
 * ### Secret redaction (two-layer)
 * 1. **Path-based** (`redact.paths`): pino removes fields whose key matches a
 *    known secret name (e.g. `token`, `password`).
 * 2. **Pattern-based** (`formatters.log`): every string value is scanned by
 *    {@link sanitizeLogObject} and any substring matching a known token format
 *    (GitHub PATs, JWTs, Bearer headers, etc.) is replaced with `[REDACTED]`.
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
    // Layer 1: redact well-known secret fields by name.
    redact: {
      paths: [
        'token',
        'secret',
        'password',
        'authorization',
        'accessToken',
        'apiKey',
        'api_key',
        '*.token',
        '*.secret',
        '*.password',
        '*.authorization',
        '*.accessToken',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
    // Layer 2: pattern-based scan of all string values in every log record.
    formatters: {
      log(object: Record<string, unknown>): Record<string, unknown> {
        return sanitizeLogObject(object);
      },
    },
  },
  pino.destination({ dest: LOG_FILE, sync: false })
);
