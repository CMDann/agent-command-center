import { WebSocketServer, WebSocket, RawData } from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import {
  MessageType,
  createMessage,
  parseMessage,
  type BridgeMessage,
  type AuthPayload,
  type AuthChallengePayload,
  type StatusUpdatePayload,
  type LogLinePayload,
  type TaskCompletePayload,
} from './protocol.js';
import { createAuthChallenge, MemoryReplayCache, verifyAuth, type AuthChallengePayload as Challenge } from './auth.js';
import type { Task } from '../types.js';

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/** How long (ms) a client has to send AUTH before the connection is closed. */
const AUTH_TIMEOUT_MS = 5_000;
/** How often (ms) the server sends PING frames to connected clients. */
const PING_INTERVAL_MS = 30_000;
/** How long (ms) to wait for a PONG before treating the client as dead. */
const PONG_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// WebSocket close codes
// ---------------------------------------------------------------------------

/** Sent when the AUTH timeout expires without a valid AUTH message. */
const CLOSE_AUTH_TIMEOUT = 4001;
/** Sent when the provided auth proof is invalid. */
const CLOSE_AUTH_FAILED = 4002;

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

interface ClientState {
  authenticated: boolean;
  agentId: string;
  challenge: Challenge;
  replayCache: MemoryReplayCache;
  authTimer: NodeJS.Timeout;
  pongTimer: NodeJS.Timeout | null;
}

// ---------------------------------------------------------------------------
// BridgeServer
// ---------------------------------------------------------------------------

export class BridgeServer extends EventEmitter {
  private readonly wss: WebSocketServer;
  private readonly tokens: Record<string, string>;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly agentSockets = new Map<string, WebSocket>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(port: number, tokens: Record<string, string>) {
    super();
    this.tokens = tokens;
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.wss.on('listening', () => {
      logger.info({ port }, 'BridgeServer listening');
    });
    this.startHeartbeat();
  }

  dispatchTask(agentId: string, task: Task): void {
    const ws = this.agentSockets.get(agentId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`BridgeServer: agent '${agentId}' is not connected`);
    }
    const msg = createMessage(MessageType.TASK_DISPATCH, agentId, {
      task: task as unknown as Record<string, unknown>,
    });
    ws.send(JSON.stringify(msg));
    logger.info({ agentId, taskId: (task as { id: string }).id }, 'Task dispatched via bridge');
  }

  isConnected(agentId: string): boolean {
    const ws = this.agentSockets.get(agentId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  async close(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const [ws, state] of this.clients) {
      clearTimeout(state.authTimer);
      if (state.pongTimer) clearTimeout(state.pongTimer);
      ws.terminate();
    }
    this.clients.clear();
    this.agentSockets.clear();

    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private onConnection(ws: WebSocket): void {
    logger.debug('BridgeServer: new connection');

    const authTimer = setTimeout(() => {
      logger.warn('BridgeServer: AUTH timeout — closing connection');
      ws.close(CLOSE_AUTH_TIMEOUT, 'AUTH timeout');
    }, AUTH_TIMEOUT_MS);

    const challenge = createAuthChallenge();
    ws.send(JSON.stringify(createMessage<AuthChallengePayload>(MessageType.AUTH_CHALLENGE, '', challenge)));

    const state: ClientState = {
      authenticated: false,
      agentId: '',
      challenge,
      replayCache: new MemoryReplayCache(),
      authTimer,
      pongTimer: null,
    };
    this.clients.set(ws, state);

    ws.on('message', (data: RawData) => this.onMessage(ws, state, data));
    ws.on('close', () => this.onClose(ws, state));
    ws.on('error', (err) => {
      logger.error({ err }, 'BridgeServer: client socket error');
    });
    ws.on('pong', () => this.onPong(state));
  }

  private onMessage(ws: WebSocket, state: ClientState, raw: RawData): void {
    const msg = parseMessage(raw as Buffer | string);
    if (!msg) {
      logger.warn('BridgeServer: received unparseable message');
      return;
    }

    if (!state.authenticated) {
      this.handleAuth(ws, state, msg);
      return;
    }

    this.handleMessage(state, msg);
  }

  private handleAuth(ws: WebSocket, state: ClientState, msg: BridgeMessage): void {
    if (msg.type !== MessageType.AUTH) {
      logger.warn({ type: msg.type }, 'BridgeServer: expected AUTH but got different type');
      ws.close(CLOSE_AUTH_FAILED, 'Unauthorized');
      return;
    }

    const payload = msg.payload as AuthPayload;

    const verified = verifyAuth({
      agentId: msg.agentId,
      challenge: state.challenge,
      payload,
      opts: { tokens: this.tokens, replayCache: state.replayCache },
    });

    if (!verified.ok) {
      logger.warn({ code: verified.code }, 'BridgeServer: AUTH failed');
      ws.close(CLOSE_AUTH_FAILED, 'Unauthorized');
      return;
    }

    clearTimeout(state.authTimer);
    state.authenticated = true;
    state.agentId = msg.agentId;
    this.agentSockets.set(msg.agentId, ws);

    const ack = createMessage(MessageType.AUTH_ACK, msg.agentId, {});
    ws.send(JSON.stringify(ack));

    logger.info({ agentId: msg.agentId, tokenId: verified.tokenId }, 'BridgeServer: client authenticated');
    this.emit('client:connected', msg.agentId);
  }

  private handleMessage(state: ClientState, msg: BridgeMessage): void {
    switch (msg.type) {
      case MessageType.STATUS_UPDATE: {
        const p = msg.payload as StatusUpdatePayload;
        logger.debug({ agentId: state.agentId, status: p.status }, 'BridgeServer: status update');
        this.emit('agent:status', state.agentId, p.status);
        break;
      }
      case MessageType.LOG_LINE: {
        const p = msg.payload as LogLinePayload;
        this.emit('agent:log', state.agentId, p.line);
        break;
      }
      case MessageType.TASK_COMPLETE: {
        const p = msg.payload as TaskCompletePayload;
        logger.info({ agentId: state.agentId, success: p.success }, 'BridgeServer: task complete');
        this.emit('agent:task_complete', state.agentId, p);
        break;
      }
      case MessageType.PONG:
        break;
      default:
        logger.warn({ type: msg.type }, 'BridgeServer: unexpected message type from client');
    }
  }

  private onClose(ws: WebSocket, state: ClientState): void {
    clearTimeout(state.authTimer);
    if (state.pongTimer) clearTimeout(state.pongTimer);
    this.clients.delete(ws);
    if (state.agentId) {
      this.agentSockets.delete(state.agentId);
      logger.info({ agentId: state.agentId }, 'BridgeServer: client disconnected');
      this.emit('client:disconnected', state.agentId);
    }
  }

  private onPong(state: ClientState): void {
    if (state.pongTimer) {
      clearTimeout(state.pongTimer);
      state.pongTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.pingInterval = setInterval(() => {
      for (const [ws, state] of this.clients) {
        if (!state.authenticated) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;

        state.pongTimer = setTimeout(() => {
          logger.warn({ agentId: state.agentId }, 'BridgeServer: PONG timeout — terminating');
          ws.terminate();
        }, PONG_TIMEOUT_MS);

        ws.ping();
        logger.debug({ agentId: state.agentId }, 'BridgeServer: sent PING');
      }
    }, PING_INTERVAL_MS);
  }
}
