import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType, createMessage } from './protocol.js';
import { signAuth } from './auth.js';

// ---------------------------------------------------------------------------
// Mock state — must be from vi.hoisted so vi.mock factory can reference it
// ---------------------------------------------------------------------------

const wssHolder = vi.hoisted(() => {
  let instance: {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
    close: (cb?: (err?: Error) => void) => void;
  } | null = null;
  return {
    get(): typeof instance { return instance; },
    set(i: typeof instance): void { instance = i; },
  };
});

// ---------------------------------------------------------------------------
// Mock ws
// ---------------------------------------------------------------------------

vi.mock('ws', () => {
  function makeHandlerMap(): {
    add(e: string, cb: (...a: unknown[]) => void): void;
    fire(e: string, ...a: unknown[]): void;
  } {
    const map: Record<string, ((...a: unknown[]) => void)[]> = {};
    return {
      add(e: string, cb: (...a: unknown[]) => void): void { (map[e] ??= []).push(cb); },
      fire(e: string, ...a: unknown[]): void { (map[e] ?? []).forEach(cb => cb(...a)); },
    };
  }

  function MockWebSocketServer(): object {
    const h = makeHandlerMap();
    const inst = {
      on(event: string, cb: (...a: unknown[]) => void): void { h.add(event, cb); },
      emit(event: string, ...a: unknown[]): void { h.fire(event, ...a); },
      close: vi.fn((cb?: (err?: Error) => void) => { cb?.(); }),
    };
    wssHolder.set(inst);
    return inst;
  }

  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1 },
  };
});

const { BridgeServer } = await import('./BridgeServer.js');

// ---------------------------------------------------------------------------
// Mock WebSocket instance
// ---------------------------------------------------------------------------

type MockWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

function createMockWs(): MockWs {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const ws: MockWs = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn((code?: number, reason?: string) => {
      ws.emit('close', code, Buffer.isBuffer(reason) ? reason : Buffer.from(reason ?? ''));
    }),
    ping: vi.fn(),
    terminate: vi.fn(),
    on(event, cb) { (handlers[event] ??= []).push(cb); },
    emit(event, ...args) { (handlers[event] ?? []).forEach(cb => cb(...args)); },
  };
  return ws;
}

const SECRET = 'test-secret';
const AGENT_ID = 'openclaw-1';
const TOKENS: Record<string, string> = { [AGENT_ID]: SECRET };

function makeRaw(msg: object): Buffer {
  return Buffer.from(JSON.stringify(msg));
}

function getChallengeFromSend(ws: MockWs): { challenge: string } {
  const first = JSON.parse(ws.send.mock.calls[0]![0] as string) as { type: string; payload: { challenge: string } };
  expect(first.type).toBe(MessageType.AUTH_CHALLENGE);
  return { challenge: first.payload.challenge };
}

function authMsg(ws: MockWs, agentId = AGENT_ID): Buffer {
  const { challenge } = getChallengeFromSend(ws);
  const payload = signAuth({
    tokenId: agentId,
    secret: TOKENS[agentId]!,
    agentId,
    challenge,
    clientNonce: 'nonce-1',
    clientTimeMs: Date.now(),
  });
  return makeRaw(createMessage(MessageType.AUTH, agentId, payload));
}

describe('BridgeServer', () => {
  let server: InstanceType<typeof BridgeServer>;
  let clientWs: MockWs;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    server = new BridgeServer(7777, TOKENS);
    clientWs = createMockWs();
  });

  afterEach(async () => {
    await server.close();
    vi.useRealTimers();
  });

  describe('AUTH', () => {
    it('accepts a connection with a valid signature and emits client:connected', () => {
      const handler = vi.fn();
      server.on('client:connected', handler);

      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));

      expect(handler).toHaveBeenCalledWith(AGENT_ID);
    });

    it('sends AUTH_ACK after successful auth (after sending AUTH_CHALLENGE)', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));

      expect(clientWs.send).toHaveBeenCalledTimes(2);
      const sent = JSON.parse(clientWs.send.mock.calls[1]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.AUTH_ACK);
    });

    it('closes with 4002 when signature is invalid', () => {
      wssHolder.get()!.emit('connection', clientWs);
      const { challenge } = getChallengeFromSend(clientWs);
      const bad = signAuth({
        tokenId: AGENT_ID,
        secret: 'wrong-secret',
        agentId: AGENT_ID,
        challenge,
        clientNonce: 'nonce-1',
        clientTimeMs: Date.now(),
      });
      clientWs.emit('message', makeRaw(createMessage(MessageType.AUTH, AGENT_ID, bad)));

      expect(clientWs.close).toHaveBeenCalledWith(4002, expect.any(String));
    });

    it('closes with 4001 when AUTH times out', () => {
      wssHolder.get()!.emit('connection', clientWs);
      vi.advanceTimersByTime(5_001);

      expect(clientWs.close).toHaveBeenCalledWith(4001, expect.any(String));
    });
  });

  describe('message routing', () => {
    beforeEach(() => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));
    });

    it('emits agent:status on STATUS_UPDATE', () => {
      const handler = vi.fn();
      server.on('agent:status', handler);

      clientWs.emit('message', makeRaw(createMessage(MessageType.STATUS_UPDATE, AGENT_ID, { status: 'working' })));

      expect(handler).toHaveBeenCalledWith(AGENT_ID, 'working');
    });

    it('emits agent:log on LOG_LINE', () => {
      const handler = vi.fn();
      server.on('agent:log', handler);

      clientWs.emit('message', makeRaw(createMessage(MessageType.LOG_LINE, AGENT_ID, { line: 'hello' })));

      expect(handler).toHaveBeenCalledWith(AGENT_ID, 'hello');
    });

    it('emits agent:task_complete on TASK_COMPLETE', () => {
      const handler = vi.fn();
      server.on('agent:task_complete', handler);

      clientWs.emit('message', makeRaw(createMessage(MessageType.TASK_COMPLETE, AGENT_ID, { success: true, prUrl: 'http://x' })));

      expect(handler).toHaveBeenCalledWith(AGENT_ID, expect.objectContaining({ success: true }));
    });
  });

  describe('heartbeat', () => {
    beforeEach(() => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));
    });

    it('sends a ping every 30 s', () => {
      vi.advanceTimersByTime(30_000);
      expect(clientWs.ping).toHaveBeenCalledOnce();
    });

    it('terminates the client if no pong arrives within 10 s of ping', () => {
      vi.advanceTimersByTime(30_000);
      vi.advanceTimersByTime(10_001);
      expect(clientWs.terminate).toHaveBeenCalledOnce();
    });

    it('does NOT terminate if pong arrives in time', () => {
      vi.advanceTimersByTime(30_000);
      clientWs.emit('pong');
      vi.advanceTimersByTime(10_001);
      expect(clientWs.terminate).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('returns false before auth', () => {
      wssHolder.get()!.emit('connection', clientWs);
      expect(server.isConnected(AGENT_ID)).toBe(false);
    });

    it('returns true after successful auth', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));
      expect(server.isConnected(AGENT_ID)).toBe(true);
    });
  });

  describe('dispatchTask', () => {
    it('throws if the agent is not connected', () => {
      expect(() => server.dispatchTask(AGENT_ID, { id: 't1' } as never)).toThrow(
        "agent 'openclaw-1' is not connected"
      );
    });

    it('sends a TASK_DISPATCH message when the agent is connected', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg(clientWs));
      clientWs.send.mockClear();

      server.dispatchTask(AGENT_ID, { id: 't1', issueNumber: 1, title: 'Fix it' } as never);

      expect(clientWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(clientWs.send.mock.calls[0]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.TASK_DISPATCH);
    });
  });

  it('emits client:disconnected when client closes', () => {
    const handler = vi.fn();
    server.on('client:disconnected', handler);

    wssHolder.get()!.emit('connection', clientWs);
    clientWs.emit('message', authMsg(clientWs));
    clientWs.emit('close', 1000, Buffer.from(''));

    expect(handler).toHaveBeenCalledWith(AGENT_ID);
  });
});
