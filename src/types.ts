/**
 * Shared data models for NEXUS.
 * All types correspond to the data models in IMPLEMENTATION.md §6.
 */

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/** The type of agent being managed. */
export type AgentType = 'claude' | 'codex' | 'openclaw';

/** Lifecycle status of an agent session. */
export type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected';

/**
 * SSH gateway configuration used to tunnel the bridge WebSocket connection
 * through an SSH server. Requires key-based authentication.
 */
export interface SshTunnelConfig {
  /** Hostname of the SSH server. */
  host: string;
  /** SSH port (default: 22). */
  port?: number;
  /** SSH username. */
  user: string;
  /** Absolute path to the private key file used for authentication. */
  keyPath: string;
}

/** Static configuration for a single agent, as stored in nexus.config.json. */
export interface AgentConfig {
  id: string;
  type: AgentType;
  workdir?: string;
  host?: string;
  port?: number;
  transport?: 'ssh' | 'websocket';
  autopr: boolean;
  /** When present, the bridge connection is tunnelled through this SSH gateway. */
  sshTunnel?: SshTunnelConfig;
}

/** Runtime session state for a connected agent. */
export interface AgentSession extends AgentConfig {
  status: AgentStatus;
  currentTask?: string;
  pid?: number;
  connectedAt?: Date;
  lastSeen?: Date;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Snapshot of the working tree status for a git repository. */
export interface GitStatus {
  branch: string;
  isDirty: boolean;
  modified: string[];
  untracked: string[];
  staged: string[];
  deleted: string[];
}

/** A single commit entry from the log. */
export interface Commit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

/** A nested git repository detected within the workspace. */
export interface SubRepo {
  name: string;
  /** Path relative to workspace root. */
  path: string;
  remote?: string;
  branch?: string;
  isDirty?: boolean;
}

// ---------------------------------------------------------------------------
// Task (maps to GitHub Issue)
// ---------------------------------------------------------------------------

/** Lifecycle status of a task as it moves through the workflow. */
export type TaskStatus = 'backlog' | 'assigned' | 'in_progress' | 'review' | 'done';

/** Whether a task assignee is an AI agent or a human contributor. */
export type AssigneeType = 'agent' | 'human';

/** A task tracked by NEXUS, backed by a GitHub Issue. */
export interface Task {
  id: string;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  status: TaskStatus;
  assigneeId?: string;
  assigneeType?: AssigneeType;
  /** Which sub-repo this task belongs to. */
  repoPath: string;
  prNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/** A raw GitHub Issue as returned by the GitHub API. */
export interface Issue {
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  assigneeLogin?: string;
  url: string;
  state: 'open' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

/** The merge/review status of a pull request. */
export type PRStatus = 'open' | 'closed' | 'merged' | 'draft';

/** A GitHub pull request. */
export interface PR {
  prNumber: number;
  title: string;
  url: string;
  status: PRStatus;
  head: string;
  base: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Filters for listing GitHub issues. */
export interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  assignee?: string;
}

/** Input required to create a new GitHub issue. */
export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

/** Input required to open a pull request. */
export interface CreatePRInput {
  title: string;
  body?: string;
  head: string;
  base: string;
}

// ---------------------------------------------------------------------------
// Contributor (human)
// ---------------------------------------------------------------------------

/** A human contributor tracked in the workspace. */
export interface Contributor {
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  currentTaskId?: string;
  role: 'owner' | 'maintainer' | 'contributor';
}
