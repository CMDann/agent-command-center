import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType, createMessage, parseMessage } from './protocol.js';

// ---------------------------------------------------------------------------
// createMessage
// ---------------------------------------------------------------------------

describe('createMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  it('returns a message with a non-empty UUID id', () => {
    const msg = createMessage(MessageType.PING, '', {});
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets the type field correctly', () => {
    const msg = createMessage(MessageType.AUTH, 'agent-1', { secret: 's' });
    expect(msg.type).toBe(MessageType.AUTH);
  });

  it('sets the agentId field', () => {
    const msg = createMessage(MessageType.LOG_LINE, 'my-agent', { line: 'hello' });
    expect(msg.agentId).toBe('my-agent');
  });

  it('includes the payload verbatim', () => {
    const payload = { secret: 'top-secret' };
    const msg = createMessage(MessageType.AUTH, '', payload);
    expect(msg.payload).toEqual(payload);
  });

  it('sets timestamp to an ISO-8601 string', () => {
    const msg = createMessage(MessageType.PING, '', {});
    expect(msg.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('generates a unique id each call', () => {
    const a = createMessage(MessageType.PING, '', {});
    const b = createMessage(MessageType.PING, '', {});
    expect(a.id).not.toBe(b.id);
  });

  it('supports all MessageType values', () => {
    const types = Object.values(MessageType);
    for (const type of types) {
      const msg = createMessage(type, 'x', {});
      expect(msg.type).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe('parseMessage', () => {
  it('parses a valid JSON string into a BridgeMessage', () => {
    const original = createMessage(MessageType.AUTH_ACK, 'agent-1', { ok: true });
    const json = JSON.stringify(original);
    const parsed = parseMessage(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(MessageType.AUTH_ACK);
    expect(parsed!.agentId).toBe('agent-1');
  });

  it('parses a Buffer containing valid JSON', () => {
    const original = createMessage(MessageType.STATUS_UPDATE, 'a', { status: 'idle' });
    const buf = Buffer.from(JSON.stringify(original), 'utf8');
    const parsed = parseMessage(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(MessageType.STATUS_UPDATE);
  });

  it('returns null for an empty string', () => {
    expect(parseMessage('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseMessage('{not valid json')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(parseMessage('"just a string"')).toBeNull();
  });

  it('returns null for a JSON object missing required fields', () => {
    const incomplete = JSON.stringify({ type: 'PING', agentId: 'x' });
    expect(parseMessage(incomplete)).toBeNull();
  });

  it('round-trips all fields correctly', () => {
    const payload = { line: 'some output' };
    const original = createMessage(MessageType.LOG_LINE, 'bob', payload);
    const parsed = parseMessage(JSON.stringify(original));
    expect(parsed).toMatchObject({
      id: original.id,
      type: MessageType.LOG_LINE,
      agentId: 'bob',
      payload,
      timestamp: original.timestamp,
    });
  });
});

// ---------------------------------------------------------------------------
// MessageType enum values
// ---------------------------------------------------------------------------

describe('MessageType', () => {
  it('has human-readable string values', () => {
    expect(MessageType.AUTH).toBe('AUTH');
    expect(MessageType.AUTH_ACK).toBe('AUTH_ACK');
    expect(MessageType.TASK_DISPATCH).toBe('TASK_DISPATCH');
    expect(MessageType.TASK_ACK).toBe('TASK_ACK');
    expect(MessageType.STATUS_UPDATE).toBe('STATUS_UPDATE');
    expect(MessageType.LOG_LINE).toBe('LOG_LINE');
    expect(MessageType.TASK_COMPLETE).toBe('TASK_COMPLETE');
    expect(MessageType.PING).toBe('PING');
    expect(MessageType.PONG).toBe('PONG');
  });
});
