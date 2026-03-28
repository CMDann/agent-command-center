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

const SECRET = 'my-secret';
const TOKEN_ID = 'claw-agent';
const AGENT_ID = 'claw-agent';
const URL = 'ws://localhost:7777';

function authChallengeMsg(): object {
  return createMessage(MessageType.AUTH_CHALLENGE, '', { challenge: 'c', serverTimeMs: 0 });
}

function authAckMsg(): object {
  return createMessage(MessageType.AUTH_ACK, AGENT_ID, {});
}

function taskDispatchMsg(task: object): object {
  return createMessage(MessageType.TASK_DISPATCH, AGENT_ID, { task });
}

describe('BridgeClient', () => {
  let client: InstanceType<typeof BridgeClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new BridgeClient(URL, AGENT_ID, TOKEN_ID, SECRET);
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  describe('connect + auth handshake', () => {
    it('does not send AUTH immediately on open (waits for challenge)', () => {
      client.connect();
      lastWsInstance.emit('open');
      expect(lastWsInstance.send).not.toHaveBeenCalled();
    });

    it('sends AUTH after receiving AUTH_CHALLENGE', () => {
      client.connect();
      lastWsInstance.emit('open');

      lastWsInstance.simulateMessage(authChallengeMsg());

      expect(lastWsInstance.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        agentId: string;
        payload: { tokenId: string; signature: string };
      };
      expect(sent.type).toBe(MessageType.AUTH);
      expect(sent.agentId).toBe(AGENT_ID);
      expect(sent.payload.tokenId).toBe(TOKEN_ID);
      expect(typeof sent.payload.signature).toBe('string');
      expect(sent.payload.signature.length).toBeGreaterThan(0);
    });

    it('emits ready when AUTH_ACK is received', () => {
      const handler = vi.fn();
      client.on('ready', handler);

      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authChallengeMsg());
      lastWsInstance.simulateMessage(authAckMsg());

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('task_dispatch event', () => {
    it('emits task_dispatch with the task payload when server sends TASK_DISPATCH', () => {
      const handler = vi.fn();
      client.on('task_dispatch', handler);
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authChallengeMsg());
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
      lastWsInstance.simulateMessage(authChallengeMsg());
      lastWsInstance.send.mockClear();

      const ping = createMessage(MessageType.PING, '', {});
      lastWsInstance.simulateMessage(ping);

      expect(lastWsInstance.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.PONG);
    });
  });

  describe('sending messages', () => {
    it('sendStatus sends STATUS_UPDATE', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authChallengeMsg());
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

    it('sendLog sends LOG_LINE', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authChallengeMsg());
      lastWsInstance.send.mockClear();

      client.sendLog('hello world');

      const sent = JSON.parse(lastWsInstance.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { line: string };
      };
      expect(sent.type).toBe(MessageType.LOG_LINE);
      expect(sent.payload.line).toBe('hello world');
    });

    it('sendTaskComplete sends TASK_COMPLETE', () => {
      client.connect();
      lastWsInstance.emit('open');
      lastWsInstance.simulateMessage(authChallengeMsg());
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

  describe('reconnect', () => {
    it('schedules a reconnect after the first disconnect', () => {
      client.connect();
      const firstWs = lastWsInstance;
      firstWs.emit('close', 1006, Buffer.from(''));

      vi.advanceTimersByTime(1_100);
      expect(lastWsInstance).not.toBe(firstWs);
    });

    it('emits error after max retries are exhausted', () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();

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

      expect(lastWsInstance).toBe(first);
    });
  });

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
