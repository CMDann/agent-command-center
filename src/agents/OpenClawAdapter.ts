import { AgentAdapter, AgentError } from './AgentAdapter.js';
import { BridgeServer } from '../bridge/BridgeServer.js';
import { BridgeClient, openSshTunnel } from '../bridge/BridgeClient.js';
import { loadBridgeTokensFromEnv } from '../bridge/tokens.js';
import { logger } from '../utils/logger.js';
import type { AgentConfig, AgentStatus, Task } from '../types.js';
import type { SshTunnel } from '../bridge/BridgeClient.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrowed view of the config fields relevant to OpenClaw server mode. */
interface ServerModeConfig extends AgentConfig {
  port: number;
}

/** Narrowed view of the config fields relevant to OpenClaw client mode. */
interface ClientModeConfig extends AgentConfig {
  host: string;
  port: number;
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Loads bridge auth tokens from env and picks the token for a specific agent.
 *
 * Selection rule (minimal MVP):
 * - If NEXUS_BRIDGE_TOKENS contains an entry for this agentId, use that.
 * - Else, fall back to tokenId "default" (supports legacy NEXUS_BRIDGE_SECRET).
 */
function requireBridgeAuth(agentId: string): { tokens: Record<string, string>; tokenId: string; secret: string } {
  let tokens: Record<string, string>;
  try {
    tokens = loadBridgeTokensFromEnv();
  } catch (err) {
    throw new AgentError(String(err), 'openclaw');
  }

  if (tokens[agentId]) {
    return { tokens, tokenId: agentId, secret: tokens[agentId]! };
  }
  if (tokens['default']) {
    return { tokens, tokenId: 'default', secret: tokens['default']! };
  }

  throw new AgentError(
    `No bridge token found for agent '${agentId}'. Set NEXUS_BRIDGE_TOKENS=${agentId}=<secret> (or provide a 'default' token).`,
    'openclaw'
  );
}

// ---------------------------------------------------------------------------
// OpenClawAdapter
// ---------------------------------------------------------------------------

/**
 * Agent adapter for OpenClaw bridge connections.
 *
 * ### Mode selection
 * Mode is intentionally explicit at the config layer:
 *
 * - **Server mode**: no `host`, no `transport`, no `sshTunnel`.
 *   The adapter starts a local {@link BridgeServer} and waits for a remote
 *   OpenClaw client to authenticate.
 *
 * - **Client mode**: requires `host` + `transport` and any transport-specific
 *   fields validated by the config schema.
 *   - `transport: "websocket"` → requires `port`
 *   - `transport: "ssh"` → requires `sshTunnel`
 *
 * ### Events forwarded
 * Status changes, log lines, and task-complete signals from the remote agent
 * are forwarded to the standard `AgentAdapter` event surface.
 */
export class OpenClawAdapter extends AgentAdapter {
  private server: BridgeServer | null = null;
  private client: BridgeClient | null = null;
  private tunnel: SshTunnel | null = null;

  /** Pending disconnect promise/resolve — used to wait for clean close. */
  private pendingDisconnect: (() => void) | null = null;

  constructor(config: AgentConfig) {
    super(config);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Establishes the bridge connection.
   *
   * In server mode: starts the WebSocket server and waits for the remote
   * OpenClaw agent to connect and authenticate (resolves immediately after
   * the server is listening; status updates come via events).
   *
   * In client mode: connects to an existing bridge server.
   */
  async connect(): Promise<void> {
    const auth = requireBridgeAuth(this.id);

    try {
      if (this.isClientMode()) {
        await this.connectClientMode(auth.tokenId, auth.secret);
      } else {
        this.connectServerMode(auth.tokens);
      }
    } catch (err) {
      this.setStatus('error');
      logger.error({ agentId: this.id, err }, 'OpenClawAdapter connect failed');
      throw new AgentError(
        `Failed to connect OpenClaw agent '${this.id}': ${String(err)}`,
        this.id
      );
    }
  }

  /**
   * Tears down the bridge connection (server or client).
   */
  async disconnect(): Promise<void> {
    logger.info({ agentId: this.id }, 'OpenClawAdapter disconnecting');

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    if (this.server) {
      await this.server.close();
      this.server = null;
    }

    if (this.tunnel) {
      this.tunnel.close();
      this.tunnel = null;
    }

    this.session = { ...this.session, currentTask: undefined, pid: undefined };
    this.setStatus('disconnected');
    this.emitLog('Disconnected');

    if (this.pendingDisconnect) {
      this.pendingDisconnect();
      this.pendingDisconnect = null;
    }
  }

  /**
   * Dispatches a task to the remote agent.
   *
   * In server mode: relays the task via the {@link BridgeServer}.
   * In client mode: not supported (the remote side dispatches tasks to us).
   *
   * @param task - The task to run.
   * @throws {AgentError} If the agent is not idle or the bridge is not ready.
   */
  async dispatch(task: Task): Promise<void> {
    if (this.session.status !== 'idle') {
      throw new AgentError(
        `Agent '${this.id}' is not idle (status: ${this.session.status})`,
        this.id
      );
    }

    if (this.server) {
      if (!this.server.isConnected(this.id)) {
        throw new AgentError(
          `OpenClaw agent '${this.id}' is not connected to the bridge server`,
          this.id
        );
      }
      this.session = { ...this.session, currentTask: task.id };
      this.setStatus('working');
      this.emitLog(`Dispatching task #${task.issueNumber}: ${task.title}`);
      this.server.dispatchTask(this.id, task);
    } else {
      throw new AgentError(
        `OpenClaw agent '${this.id}' in client mode cannot dispatch tasks`,
        this.id
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mode implementations
  // ---------------------------------------------------------------------------

  private isClientMode(): boolean {
    return this.session.host !== undefined && this.session.transport !== undefined;
  }

  private connectServerMode(tokens: Record<string, string>): void {
    const config = this.session as ServerModeConfig;
    const port = config.port ?? 7777;

    this.server = new BridgeServer(port, tokens);
    this.emitLog(`Bridge server listening on port ${port}`);
    logger.info({ agentId: this.id, port }, 'OpenClawAdapter: server mode started');

    this.server.on('client:connected', (agentId: string) => {
      if (agentId !== this.id) return;
      this.session = { ...this.session, connectedAt: new Date() };
      this.setStatus('idle');
      this.emitLog('Remote OpenClaw agent connected');
    });

    this.server.on('client:disconnected', (agentId: string) => {
      if (agentId !== this.id) return;
      this.setStatus('disconnected');
      this.emitLog('Remote OpenClaw agent disconnected');
    });

    this.wireServerEvents();
  }

  private async connectClientMode(tokenId: string, secret: string): Promise<void> {
    const config = this.session as ClientModeConfig;
    const host = config.host;
    const port = config.port ?? 7777;

    let wsHost = host;
    let wsPort = port;

    // Open SSH tunnel if configured.
    if (this.session.sshTunnel) {
      this.emitLog(`Opening SSH tunnel via ${this.session.sshTunnel.host}`);
      this.tunnel = await openSshTunnel(this.session.sshTunnel, host, port);
      wsHost = '127.0.0.1';
      wsPort = this.tunnel.localPort;
      logger.info(
        { agentId: this.id, localPort: wsPort },
        'OpenClawAdapter: SSH tunnel established'
      );
    }

    const url = `ws://${wsHost}:${wsPort}`;
    this.client = new BridgeClient(url, this.id, tokenId, secret);

    this.client.on('ready', () => {
      this.session = { ...this.session, connectedAt: new Date() };
      this.setStatus('idle');
      this.emitLog('Connected to bridge server');
    });

    this.client.on('disconnected', () => {
      if (this.session.status !== 'disconnected') {
        this.setStatus('disconnected');
        this.emitLog('Disconnected from bridge server');
      }
    });

    this.client.on('error', (err: Error) => {
      // When BridgeClient exhausts all reconnect attempts it emits this
      // specific message. Mark the agent as 'disconnected' (not 'error') so
      // the TUI shows the expected state and the user can use [c] to reconnect.
      const isMaxRetries = err.message.includes('max reconnect retries exhausted');
      if (isMaxRetries) {
        this.setStatus('disconnected');
        this.emitLog(
          `⚠ Reconnect failed after 5 attempts — agent is unreachable. Use [c] to reconnect.`
        );
      } else {
        this.setStatus('error');
        this.emitLog(`Bridge error: ${err.message}`);
      }
      logger.error({ agentId: this.id, err }, 'OpenClawAdapter: bridge client error');
    });

    this.wireClientEvents();
    this.client.connect();
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  private wireServerEvents(): void {
    if (!this.server) return;

    this.server.on('agent:status', (agentId: string, status: string) => {
      if (agentId !== this.id) return;
      this.setStatus(status as AgentStatus);
    });

    this.server.on('agent:log', (agentId: string, line: string) => {
      if (agentId !== this.id) return;
      this.emitLog(line);
    });

    this.server.on('agent:task_complete', (agentId: string, payload: Record<string, unknown>) => {
      if (agentId !== this.id) return;
      this.session = { ...this.session, currentTask: undefined, lastSeen: new Date() };
      this.setStatus('idle');
      this.emitLog('Task complete');
      this.emit('task_complete', {
        prUrl: payload['prUrl'] as string | undefined,
        prNumber: payload['prNumber'] as number | undefined,
      });
    });
  }

  private wireClientEvents(): void {
    if (!this.client) return;

    this.client.on('task_dispatch', (task: Task) => {
      // In client mode, the server is giving us a task to run locally.
      // Emit a log line and mark status as working; the actual execution
      // is handled by whichever component receives the event.
      this.session = { ...this.session, currentTask: (task as { id: string }).id };
      this.setStatus('working');
      this.emitLog(`Received task from bridge: ${JSON.stringify(task)}`);
    });
  }
}
