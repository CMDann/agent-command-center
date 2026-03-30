/**
 * Log sanitization utilities.
 *
 * Provides pattern-based redaction of secret-like strings before they
 * reach the log sink, supplementing pino's path-based `redact` option.
 */

// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns that identify common secret/token formats.
 * Each pattern targets a specific token type.
 */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /ghp_[A-Za-z0-9]{20,}/g,                                              // GitHub PATs
  /ghs_[A-Za-z0-9]{20,}/g,                                              // GitHub server tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,                                      // GitHub fine-grained PATs
  /gho_[A-Za-z0-9]{20,}/g,                                              // GitHub OAuth tokens
  /glpat-[A-Za-z0-9\-_]{20,}/g,                                         // GitLab PATs
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,                                   // HTTP Bearer tokens
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,   // JWT tokens
  /sk-[A-Za-z0-9]{20,}/g,                                               // OpenAI-style API keys
  /AKIA[A-Z0-9]{16}/g,                                                  // AWS access key IDs
];

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Replaces any token/secret-like substring in a string with `[REDACTED]`.
 *
 * Patterns cover: GitHub PATs, GitLab PATs, JWT tokens, HTTP Bearer headers,
 * OpenAI-style keys, and AWS access key IDs.
 *
 * @param s - Input string to sanitize.
 * @returns The sanitized string with secrets replaced.
 */
export function sanitizeString(s: string): string {
  let result = s;
  for (const pattern of SECRET_PATTERNS) {
    // Construct a fresh RegExp from the source/flags to reset `lastIndex`
    // for global patterns used across multiple calls.
    result = result.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]');
  }
  return result;
}

/**
 * Deep-walks a plain log object, applying {@link sanitizeString} to all
 * string leaves. Non-string leaves (numbers, booleans, null, arrays) are
 * left unchanged. Cycles in nested objects are skipped gracefully.
 *
 * This function is intended to be plugged into pino's `formatters.log` hook
 * so every structured log entry is sanitized before it reaches the sink.
 *
 * @param obj   - The log record to sanitize.
 * @param _seen - Internal visited-object set used to detect cycles.
 * @returns A new object with secrets redacted.
 */
export function sanitizeLogObject(
  obj: Record<string, unknown>,
  _seen: WeakSet<object> = new WeakSet()
): Record<string, unknown> {
  if (_seen.has(obj)) return { '[circular]': true };
  _seen.add(obj);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out[key] = sanitizeString(value);
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = sanitizeLogObject(value as Record<string, unknown>, _seen);
    } else {
      out[key] = value;
    }
  }
  return out;
}
