import WebSocket, { type RawData } from 'ws';
import { EventEmitter } from 'events';
import net from 'net';
import { Client as SshClient } from 'ssh2';
import { readFileSync } from 'fs';
import { logger } from '../utils/logger.js';
import {
  MessageType,
  createMessage,
  parseMessage,
  type BridgeMessage,
  type StatusUpdatePayload,
  type LogLinePayload,
  type TaskCompletePayload,
} from './protocol.js';
import type { AgentStatus, SshTunnelConfig, Task } from '../types.js';

// ---------------------------------------------------------------------------
// Reconnect constants
// ---------------------------------------------------------------------------

/** Backoff delay (ms) for each retry attempt (index 0 = first retry). */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

// ---------------------------------------------------------------------------
// SSH tunnel helpers
// ---------------------------------------------------------------------------

/** Result returned by {@link openSshTunnel}. */
export interface SshTunnel {
  /** Local TCP port that forwards to the remote bridge server. */
  localPort: number;
  /** Closes the SSH connection and the local listener. */
  close(): void;
}

/**
 * Opens an SSH tunnel that forwards a local ephemeral port to
 * `remoteHost:remotePort` via the SSH gateway described in `config`.
 *
 * Uses key-based authentication only (no passwords).
 *
 * @param config - SSH gateway configuration.
 * @param remoteHost - Host reachable from the SSH server (often 'localhost').
 * @param remotePort - Port on `remoteHost` to forward to.
 * @returns A promise that resolves once the local port is ready to accept connections.
 */
export function openSshTunnel(
  config: SshTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<SshTunnel> {
  return new Promise((resolve, reject) => {
    const ssh = new SshClient();
    let localServer: net.Server | null = null;
    let resolved = false;

    ssh.on('ready', () => {
      // Create a local TCP server; each incoming connection is tunnelled.
      localServer = net.createServer((localSocket) => {
        ssh.forwardOut(
          '127.0.0.1',
          localSocket.localPort ?? 0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              logger.error({ err }, 'SSH tunnel: forwardOut failed');
              localSocket.destroy();
              return;
            }
            localSocket.pipe(stream);
            stream.pipe(localSocket);
            stream.on('close', () => localSocket.destroy());
            localSocket.on('close', () => stream.destroy());
          }
        );
      });

      // Bind to a random free port.
      localServer.listen(0, '127.0.0.1', () => {
        const addr = localServer!.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('SSH tunnel: could not determine local port'));
          return;
        }
        resolved = true;
        resolve({
          localPort: addr.port,
          close: (): void => {
            localServer?.close();
            ssh.end();
          },
        });
      });

      localServer.on('error', (err) => {
        logger.error({ err }, 'SSH tunnel: local server error');
      });
    });

    ssh.on('error', (err) => {
      if (!resolved) reject(err);
      else logger.error({ err }, 'SSH tunnel: connection error');
    });

    ssh.connect({
      host: config.host,
      port: config.port ?? 22,
      username: config.user,
      privateKey: readFileSync(config.keyPath),
    });
  });
}

// ---------------------------------------------------------------------------
// BridgeClient
// ---------------------------------------------------------------------------

/**
 * WebSocket client used by remote OpenClaw agents to connect to the NEXUS
 * bridge server.
 *
 * ### Connection lifecycle
 * 1. `connect()` opens a WebSocket to the bridge server.
 * 2. On `open`, sends `AUTH { secret, agentId }`.
 * 3. Server replies with `AUTH_ACK` → emits `'ready'`.
 * 4. If the connection drops, backs off and retries (max 5 attempts).
 *
 * ### Events emitted
 * | Event | Args | Description |
 * |-------|------|-------------|
 * | `'ready'` | — | AUTH handshake succeeded |
 * | `'disconnected'` | — | Socket closed (final or between retries) |
 * | `'task_dispatch'` | `task: Record<string, unknown>` | Server dispatched a task |
 * | `'error'` | `err: Error` | Unrecoverable error |
 */
export class BridgeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly url: string;
  private readonly agentId: string;
  private readonly secret: string;

  /**
   * @param url     - WebSocket URL of the bridge server (e.g. `ws://host:7777`).
   * @param agentId - The agent ID to authenticate as.
   * @param secret  - Pre-shared secret matching `NEXUS_BRIDGE_SECRET`.
   */
  constructor(url: string, agentId: string, secret: string) {
    super();
    this.url = url;
    this.agentId = agentId;
    this.secret = secret;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initiates the first connection attempt.
   * Subsequent reconnects happen automatically on disconnect.
   */
  connect(): void {
    this.stopped = false;
    this.retryCount = 0;
    this.openSocket();
  }

  /**
   * Permanently closes the connection (no more reconnects).
   */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info({ agentId: this.agentId }, 'BridgeClient: disconnected');
  }

  /**
   * Sends a STATUS_UPDATE message to the server.
   *
   * @param status - The new agent status.
   */
  sendStatus(status: AgentStatus): void {
    this.send(createMessage<StatusUpdatePayload>(MessageType.STATUS_UPDATE, this.agentId, { status }));
  }

  /**
   * Sends a LOG_LINE message to the server.
   *
   * @param line - The log line text.
   */
  sendLog(line: string): void {
    this.send(createMessage<LogLinePayload>(MessageType.LOG_LINE, this.agentId, { line }));
  }

  /**
   * Sends a TASK_COMPLETE message to the server.
   *
   * @param payload - Task completion details.
   */
  sendTaskComplete(payload: TaskCompletePayload): void {
    this.send(createMessage<TaskCompletePayload>(MessageType.TASK_COMPLETE, this.agentId, payload));
  }

  // ---------------------------------------------------------------------------
  // Internal socket management
  // ---------------------------------------------------------------------------

  private openSocket(): void {
    logger.info({ agentId: this.agentId, url: this.url }, 'BridgeClient: connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      logger.debug({ agentId: this.agentId }, 'BridgeClient: socket open — sending AUTH');
      this.retryCount = 0;
      ws.send(
        JSON.stringify(
          createMessage(MessageType.AUTH, this.agentId, { secret: this.secret })
        )
      );
    });

    ws.on('message', (data: RawData) => this.onMessage(data));

    ws.on('close', (code, reason) => {
      logger.info(
        { agentId: this.agentId, code, reason: reason.toString() },
        'BridgeClient: socket closed'
      );
      this.ws = null;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error({ agentId: this.agentId, err }, 'BridgeClient: socket error');
      this.emit('error', err);
    });

    ws.on('ping', () => {
      ws.pong();
    });
  }

  private onMessage(raw: RawData): void {
    const msg = parseMessage(raw as Buffer | string);
    if (!msg) {
      logger.warn('BridgeClient: received unparseable message');
      return;
    }

    switch (msg.type) {
      case MessageType.AUTH_ACK:
        logger.info({ agentId: this.agentId }, 'BridgeClient: AUTH_ACK received — ready');
        this.emit('ready');
        break;
      case MessageType.TASK_DISPATCH:
        logger.info({ agentId: this.agentId }, 'BridgeClient: TASK_DISPATCH received');
        this.emit('task_dispatch', (msg as BridgeMessage<{ task: Task }>).payload.task);
        break;
      case MessageType.PING:
        this.send(createMessage(MessageType.PONG, this.agentId, {}));
        break;
      default:
        logger.debug({ type: msg.type }, 'BridgeClient: unhandled message type');
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    const delay = RECONNECT_DELAYS_MS[this.retryCount] ?? null;
    if (delay === null) {
      logger.error(
        { agentId: this.agentId, retries: this.retryCount },
        'BridgeClient: max retries reached — giving up'
      );
      this.emit('error', new Error('BridgeClient: max reconnect retries exhausted'));
      return;
    }

    this.retryCount++;
    logger.info(
      { agentId: this.agentId, attempt: this.retryCount, delayMs: delay },
      'BridgeClient: scheduling reconnect'
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.openSocket();
    }, delay);
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      logger.warn({ agentId: this.agentId }, 'BridgeClient: attempted send on non-open socket');
    }
  }
}

// Re-export for convenience.
export type { TaskCompletePayload };
