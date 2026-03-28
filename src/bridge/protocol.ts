import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/**
 * All message types exchanged over the NEXUS bridge WebSocket connection.
 *
 * String enum values are used so messages are human-readable when serialised
 * to JSON (e.g. for debugging or logging).
 */
export enum MessageType {
  /** Client → Server: prove identity with the shared secret. */
  AUTH = 'AUTH',
  /** Server → Client: authentication accepted; connection is live. */
  AUTH_ACK = 'AUTH_ACK',
  /** Server → Client: dispatch a task to the remote agent. */
  TASK_DISPATCH = 'TASK_DISPATCH',
  /** Client → Server: task received and started. */
  TASK_ACK = 'TASK_ACK',
  /** Client → Server: agent status changed (idle, working, error, …). */
  STATUS_UPDATE = 'STATUS_UPDATE',
  /** Client → Server: one line of agent log output. */
  LOG_LINE = 'LOG_LINE',
  /** Client → Server: task has finished (success or failure). */
  TASK_COMPLETE = 'TASK_COMPLETE',
  /** Server → Client: keep-alive probe. */
  PING = 'PING',
  /** Client → Server: response to PING. */
  PONG = 'PONG',
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * Every message sent over the bridge follows this structure.
 *
 * @typeParam P - The shape of the `payload` object for this message type.
 *               Defaults to `Record<string, unknown>` for generic consumers.
 */
export interface BridgeMessage<P extends Record<string, unknown> = Record<string, unknown>> {
  /** RFC-4122 UUID v4 — uniquely identifies this message. */
  id: string;
  /** Discriminant that determines how `payload` should be interpreted. */
  type: MessageType;
  /**
   * The agent this message pertains to.
   * Set to an empty string for global messages (AUTH, PING, PONG).
   */
  agentId: string;
  /** Type-specific data. */
  payload: P;
  /** ISO-8601 timestamp set at the moment the message is created. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Typed payload shapes
// ---------------------------------------------------------------------------

/** Payload for AUTH messages. */
export interface AuthPayload extends Record<string, unknown> {
  /** Shared secret from `NEXUS_BRIDGE_SECRET`. */
  secret: string;
}

/** Payload for STATUS_UPDATE messages. */
export interface StatusUpdatePayload extends Record<string, unknown> {
  /** New agent status. */
  status: string;
}

/** Payload for LOG_LINE messages. */
export interface LogLinePayload extends Record<string, unknown> {
  /** The log line text. */
  line: string;
}

/** Payload for TASK_COMPLETE messages. */
export interface TaskCompletePayload extends Record<string, unknown> {
  /** Whether the task finished successfully. */
  success: boolean;
  /** Optional GitHub PR URL produced by the agent. */
  prUrl?: string;
  /** Optional GitHub PR number produced by the agent. */
  prNumber?: number;
  /** Error message when `success` is false. */
  error?: string;
}

/** Payload for TASK_DISPATCH messages. */
export interface TaskDispatchPayload extends Record<string, unknown> {
  /** Serialised Task object. */
  task: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Creates a {@link BridgeMessage} with a fresh UUID and current timestamp.
 *
 * @param type    - The message type.
 * @param agentId - The target / source agent ID (empty string for global msgs).
 * @param payload - Type-specific payload data.
 * @returns A complete, ready-to-serialise BridgeMessage.
 */
export function createMessage<P extends Record<string, unknown>>(
  type: MessageType,
  agentId: string,
  payload: P
): BridgeMessage<P> {
  return {
    id: randomUUID(),
    type,
    agentId,
    payload,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

/**
 * Parses a raw WebSocket data buffer or string into a {@link BridgeMessage}.
 * Returns `null` if the data cannot be parsed.
 *
 * @param raw - Raw data received from the WebSocket.
 */
export function parseMessage(raw: Buffer | string): BridgeMessage | null {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    const obj = JSON.parse(text) as unknown;
    if (
      typeof obj === 'object' &&
      obj !== null &&
      'id' in obj &&
      'type' in obj &&
      'agentId' in obj &&
      'payload' in obj &&
      'timestamp' in obj
    ) {
      return obj as BridgeMessage;
    }
    return null;
  } catch {
    return null;
  }
}
