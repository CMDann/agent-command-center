import crypto from 'node:crypto';

export interface AuthChallengePayload extends Record<string, unknown> {
  /** Random server challenge (base64url). */
  challenge: string;
  /** Server unix epoch milliseconds. */
  serverTimeMs: number;
}

export interface AuthPayload extends Record<string, unknown> {
  /** Non-secret token identifier. */
  tokenId: string;
  /** Client unix epoch milliseconds. */
  clientTimeMs: number;
  /** Random client nonce (base64url). */
  clientNonce: string;
  /** HMAC-SHA256 signature (base64url). */
  signature: string;
}

export type AuthVerifyErrorCode =
  | 'missing'
  | 'invalid_format'
  | 'unknown_token'
  | 'expired'
  | 'replay'
  | 'bad_signature';

export type AuthVerifyResult =
  | { ok: true; tokenId: string }
  | { ok: false; code: AuthVerifyErrorCode };

export interface AuthVerifyOptions {
  /** Map of tokenId -> shared secret (never sent over the wire). */
  tokens: Record<string, string>;
  /** Max allowed clock skew between client and server. Default: 30s. */
  maxSkewMs?: number;
  /** TTL for replay cache entries. Default: 60s. */
  replayWindowMs?: number;
  replayCache?: ReplayCache;
  nowMs?: number;
}

export interface ReplayCache {
  has(key: string): boolean;
  add(key: string, expiresAtMs: number): void;
  purge(nowMs: number): void;
}

export class MemoryReplayCache implements ReplayCache {
  private readonly entries = new Map<string, number>();

  has(key: string): boolean {
    return this.entries.has(key);
  }

  add(key: string, expiresAtMs: number): void {
    this.entries.set(key, expiresAtMs);
  }

  purge(nowMs: number): void {
    for (const [key, exp] of this.entries) {
      if (exp <= nowMs) this.entries.delete(key);
    }
  }
}

export function createAuthChallenge(nowMs = Date.now()): AuthChallengePayload {
  return {
    challenge: base64url(crypto.randomBytes(24)),
    serverTimeMs: nowMs,
  };
}

/**
 * HMAC input binds tokenId + agentId + per-connection challenge + per-message nonce + time.
 * This prevents replay and prevents using a token to impersonate another agentId.
 */
function signatureInput(params: {
  tokenId: string;
  agentId: string;
  challenge: string;
  clientNonce: string;
  clientTimeMs: number;
}): string {
  const { tokenId, agentId, challenge, clientNonce, clientTimeMs } = params;
  return `${tokenId}.${agentId}.${challenge}.${clientNonce}.${clientTimeMs}`;
}

export function signAuth(params: {
  tokenId: string;
  secret: string;
  agentId: string;
  challenge: string;
  clientNonce: string;
  clientTimeMs: number;
}): AuthPayload {
  const { tokenId, secret, agentId, challenge, clientNonce, clientTimeMs } = params;
  const input = signatureInput({ tokenId, agentId, challenge, clientNonce, clientTimeMs });
  const signature = base64url(crypto.createHmac('sha256', secret).update(input).digest());
  return { tokenId, clientNonce, clientTimeMs, signature };
}

export function verifyAuth(params: {
  agentId: string;
  challenge: AuthChallengePayload;
  payload: Partial<AuthPayload> | undefined;
  opts: AuthVerifyOptions;
}): AuthVerifyResult {
  const { agentId, challenge, payload, opts } = params;
  const nowMs = opts.nowMs ?? Date.now();
  const maxSkewMs = opts.maxSkewMs ?? 30_000;
  const replayWindowMs = opts.replayWindowMs ?? 60_000;
  const replayCache = opts.replayCache ?? new MemoryReplayCache();

  if (!payload) return { ok: false, code: 'missing' };
  if (
    typeof payload.tokenId !== 'string' ||
    typeof payload.clientNonce !== 'string' ||
    typeof payload.signature !== 'string' ||
    typeof payload.clientTimeMs !== 'number'
  ) {
    return { ok: false, code: 'invalid_format' };
  }

  const secret = opts.tokens[payload.tokenId];
  if (!secret) return { ok: false, code: 'unknown_token' };

  replayCache.purge(nowMs);

  if (Math.abs(nowMs - payload.clientTimeMs) > maxSkewMs) {
    return { ok: false, code: 'expired' };
  }

  const replayKey = `${payload.tokenId}.${agentId}.${challenge.challenge}.${payload.clientNonce}`;
  if (replayCache.has(replayKey)) return { ok: false, code: 'replay' };

  const input = signatureInput({
    tokenId: payload.tokenId,
    agentId,
    challenge: challenge.challenge,
    clientNonce: payload.clientNonce,
    clientTimeMs: payload.clientTimeMs,
  });
  const expected = crypto.createHmac('sha256', secret).update(input).digest();

  let provided: Buffer;
  try {
    provided = base64urlToBuf(payload.signature);
  } catch {
    return { ok: false, code: 'invalid_format' };
  }

  if (provided.length !== expected.length) return { ok: false, code: 'bad_signature' };
  if (!crypto.timingSafeEqual(provided, expected)) return { ok: false, code: 'bad_signature' };

  replayCache.add(replayKey, nowMs + replayWindowMs);
  return { ok: true, tokenId: payload.tokenId };
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64urlToBuf(s: string): Buffer {
  const normalized = s.replaceAll('-', '+').replaceAll('_', '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}
