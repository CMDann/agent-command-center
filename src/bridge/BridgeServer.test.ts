import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType, createMessage } from './protocol.js';

// ---------------------------------------------------------------------------
// Mock state — must be from vi.hoisted so vi.mock factory can reference it
// ---------------------------------------------------------------------------

/** Mutable holder for the most recently created WebSocketServer mock. */
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
// Mock ws — factory only references vi.hoisted values and built-ins
// ---------------------------------------------------------------------------

vi.mock('ws', () => {
  /** Tiny hand-rolled event bus used inside the mock. */
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
    // RawData is only used as a type in BridgeServer — no runtime value needed.
  };
});

// Import AFTER mock is registered.
const { BridgeServer } = await import('./BridgeServer.js');

// ---------------------------------------------------------------------------
// Mock WebSocket instance — EventEmitter via Node built-in
// A new MockWs is created per test and passed to the wss 'connection' event.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-secret';
const AGENT_ID = 'openclaw-1';

function makeRaw(msg: object): Buffer {
  return Buffer.from(JSON.stringify(msg));
}

function authMsg(secret = SECRET, agentId = AGENT_ID): Buffer {
  return makeRaw(createMessage(MessageType.AUTH, agentId, { secret }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BridgeServer', () => {
  let server: InstanceType<typeof BridgeServer>;
  let clientWs: MockWs;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new BridgeServer(7777, SECRET);
    clientWs = createMockWs();
  });

  afterEach(async () => {
    await server.close();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // AUTH flow
  // -------------------------------------------------------------------------

  describe('AUTH', () => {
    it('accepts a connection with the correct secret and emits client:connected', () => {
      const handler = vi.fn();
      server.on('client:connected', handler);

      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());

      expect(handler).toHaveBeenCalledWith(AGENT_ID);
    });

    it('sends AUTH_ACK after successful auth', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());

      expect(clientWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(clientWs.send.mock.calls[0]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.AUTH_ACK);
    });

    it('closes with 4002 when the secret is wrong', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg('wrong-secret'));

      expect(clientWs.close).toHaveBeenCalledWith(4002, expect.any(String));
    });

    it('closes with 4001 when AUTH times out', () => {
      wssHolder.get()!.emit('connection', clientWs);
      vi.advanceTimersByTime(5_001);

      expect(clientWs.close).toHaveBeenCalledWith(4001, expect.any(String));
    });

    it('does not close early if AUTH arrives before timeout', () => {
      wssHolder.get()!.emit('connection', clientWs);
      vi.advanceTimersByTime(4_000);
      clientWs.emit('message', authMsg());
      vi.advanceTimersByTime(2_000);

      expect(clientWs.close).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Message routing (after auth)
  // -------------------------------------------------------------------------

  describe('message routing', () => {
    beforeEach(() => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());
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

    it('ignores unparseable messages without throwing', () => {
      const handler = vi.fn();
      server.on('agent:status', handler);

      expect(() => clientWs.emit('message', Buffer.from('{bad json'))).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  describe('heartbeat', () => {
    beforeEach(() => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());
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

  // -------------------------------------------------------------------------
  // isConnected / dispatchTask
  // -------------------------------------------------------------------------

  describe('isConnected', () => {
    it('returns false before auth', () => {
      wssHolder.get()!.emit('connection', clientWs);
      expect(server.isConnected(AGENT_ID)).toBe(false);
    });

    it('returns true after successful auth', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());
      expect(server.isConnected(AGENT_ID)).toBe(true);
    });

    it('returns false after disconnect', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());
      clientWs.emit('close', 1000, Buffer.from(''));
      expect(server.isConnected(AGENT_ID)).toBe(false);
    });
  });

  describe('dispatchTask', () => {
    it('throws if the agent is not connected', () => {
      expect(() =>
        server.dispatchTask(AGENT_ID, { id: 't1' } as never)
      ).toThrow("agent 'openclaw-1' is not connected");
    });

    it('sends a TASK_DISPATCH message when the agent is connected', () => {
      wssHolder.get()!.emit('connection', clientWs);
      clientWs.emit('message', authMsg());
      clientWs.send.mockClear();

      server.dispatchTask(AGENT_ID, { id: 't1', issueNumber: 1, title: 'Fix it' } as never);

      expect(clientWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(clientWs.send.mock.calls[0]![0] as string) as { type: string };
      expect(sent.type).toBe(MessageType.TASK_DISPATCH);
    });
  });

  // -------------------------------------------------------------------------
  // Disconnect cleanup
  // -------------------------------------------------------------------------

  it('emits client:disconnected when client closes', () => {
    const handler = vi.fn();
    server.on('client:disconnected', handler);

    wssHolder.get()!.emit('connection', clientWs);
    clientWs.emit('message', authMsg());
    clientWs.emit('close', 1000, Buffer.from(''));

    expect(handler).toHaveBeenCalledWith(AGENT_ID);
  });
});
