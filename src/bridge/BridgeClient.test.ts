import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { MessageType, createMessage } from './protocol.js';

// ---------------------------------------------------------------------------
// Mock ws
// ---------------------------------------------------------------------------

class MockWsInstance extends EventEmitter {
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn();
  ping = vi.fn();
  pong = vi.fn();

  /** Helper: simulate the server sending a message to us. */
  simulateMessage(msg: object): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
}

let lastWsInstance: MockWsInstance;

vi.mock('ws', async () => {
  const actual = await vi.importActual<typeof import('ws')>('ws');
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const instance = new MockWsInstance();
    lastWsInstance = instance;
    return instance;
  });
  (MockWebSocket as unknown as { OPEN: number }).OPEN = 1;
  return {
    ...actual,
    default: MockWebSocket,
    WebSocket: MockWebSocket,
  };
});

const { BridgeClient } = await import('./BridgeClient.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'my-secret';
const AGENT_ID = 'claw-agent';
const URL = 'ws://localhost:7777';

function authAckMsg(): object {
  return createMessage(MessageType.AUTH_ACK, AGENT_ID, {});
}

function taskDispatchMsg(task: object): object {
  return createMessage(MessageType.TASK_DISPATCH, AGENT_ID, { task });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BridgeClient', () => {
  let client: InstanceType<typeof BridgeClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new BridgeClient(URL, AGENT_ID, SECRET);
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Initial connection + AUTH
  // -------------------------------------------------------------------------

  describe('connect', () => {
    it('sends AUTH message immediately when socket opens', () => {
      client.connect();
      lastWsInstance.emit('open');

      expect(lastWsInstance.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        agentId: string;
        payload: { secret: string };
      };
      expect(sent.type).toBe(MessageType.AUTH);
      expect(sent.agentId).toBe(AGENT_ID);
      expect(sent.payload.secret).toBe(SECRET);
    });

    it('emits ready when AUTH_ACK is received', () => {
      const handler = vi.fn();
      client.on('ready', handler);

      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authAckMsg());

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  describe('task_dispatch event', () => {
    it('emits task_dispatch with the task payload when server sends TASK_DISPATCH', () => {
      const handler = vi.fn();
      client.on('task_dispatch', handler);
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authAckMsg());

      const task = { id: 't1', title: 'Do thing' };
      lastWsInstance.simulateMessage(taskDispatchMsg(task));

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    });
  });

  describe('PING handling', () => {
    it('replies with PONG when server sends PING', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.send.mockClear();

      const ping = createMessage(MessageType.PING, '', {});
      lastWsInstance.simulateMessage(ping);

      expect(lastWsInstance.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.PONG);
    });
  });

  // -------------------------------------------------------------------------
  // Sending messages
  // -------------------------------------------------------------------------

  describe('sendStatus', () => {
    it('sends a STATUS_UPDATE message', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.send.mockClear();

      client.sendStatus('idle');

      expect(lastWsInstance.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { status: string };
      };
      expect(sent.type).toBe(MessageType.STATUS_UPDATE);
      expect(sent.payload.status).toBe('idle');
    });
  });

  describe('sendLog', () => {
    it('sends a LOG_LINE message', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.send.mockClear();

      client.sendLog('hello world');

      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { line: string };
      };
      expect(sent.type).toBe(MessageType.LOG_LINE);
      expect(sent.payload.line).toBe('hello world');
    });
  });

  describe('sendTaskComplete', () => {
    it('sends a TASK_COMPLETE message with the payload', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.send.mockClear();

      client.sendTaskComplete({ success: true, prUrl: 'http://gh/1' });

      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { success: boolean; prUrl: string };
      };
      expect(sent.type).toBe(MessageType.TASK_COMPLETE);
      expect(sent.payload.success).toBe(true);
      expect(sent.payload.prUrl).toBe('http://gh/1');
    });
  });

  // -------------------------------------------------------------------------
  // Reconnect logic
  // -------------------------------------------------------------------------

  describe('reconnect', () => {
    it('schedules a reconnect after the first disconnect', () => {
      const wsSpy = vi.fn().mockImplementation(() => {
        const instance = new MockWsInstance();
        lastWsInstance = instance;
        return instance;
      });
      (wsSpy as unknown as { OPEN: number }).OPEN = 1;

      client.connect();
      const firstWs = lastWsInstance;
      firstWs.emit('close', 1006, Buffer.from(''));

      // Advance past the first retry delay (1 s).
      vi.advanceTimersByTime(1_100);
      // A second socket should have been created.
      expect(lastWsInstance).not.toBe(firstWs);
    });

    it('emits error after max retries are exhausted', () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();

      // Exhaust all 5 retry delays: 1s, 2s, 4s, 8s, 16s = 31 s total.
      for (let i = 0; i < 5; i++) {
        lastWsInstance.emit('close', 1006, Buffer.from(''));
        vi.advanceTimersByTime(17_000);
      }
      lastWsInstance.emit('close', 1006, Buffer.from(''));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('max reconnect') })
      );
    });

    it('stops reconnecting after disconnect() is called', () => {
      client.connect();
      const first = lastWsInstance;
      client.disconnect();

      first.emit('close', 1006, Buffer.from(''));
      vi.advanceTimersByTime(2_000);

      // lastWsInstance should still be the first one (no new socket created).
      expect(lastWsInstance).toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('does not send if socket is not open', () => {
    client.connect();
    lastWsInstance.readyState = 3; // CLOSED
    client.sendLog('should not send');
    expect(lastWsInstance.send).not.toHaveBeenCalled();
  });

  it('ignores unparseable messages without throwing', () => {
    client.connect();
    lastWsInstance.emit('open');
    expect(() => {
      lastWsInstance.emit('message', Buffer.from('{bad'));
    }).not.toThrow();
  });
});
