# NEXUS — Implementation Plan

> **Version:** 1.0  
> **Status:** Planning  
> **Author:** CURA / Dann  
> **Last Updated:** 2026-03-28

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [System Architecture](#3-system-architecture)
4. [Phase Breakdown](#4-phase-breakdown)
5. [Module Specifications](#5-module-specifications)
6. [Data Models](#6-data-models)
7. [Agent Communication Protocol](#7-agent-communication-protocol)
8. [UI Layout Specification](#8-ui-layout-specification)
9. [GitHub & Git Integration](#9-github--git-integration)
10. [Task Assignment Engine](#10-task-assignment-engine)
11. [Security Considerations](#11-security-considerations)
12. [Testing Strategy](#12-testing-strategy)
13. [Milestones & Timeline](#13-milestones--timeline)
14. [Open Questions](#14-open-questions)

---

## 1. Project Overview

NEXUS is a terminal dashboard that serves as a command centre for orchestrating multiple AI coding agents and human contributors across one or more GitHub repositories.

### Core Goals
- Provide a single TUI to manage all agents and contributors
- Connect to remote agents over the network (OpenClaw)
- Route GitHub issues as tasks to agents or humans
- Enforce PR-based workflows for all agent code changes
- Support monorepos and multi-repo workspaces (subrepos)
- Give real-time visibility into git state, PR status, and task queues

### Non-Goals (v1)
- Web UI (terminal-only for v1)
- Billing or cost tracking per agent
- CI/CD pipeline management
- Secrets vault management

---

## 2. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20+ | Broad ecosystem, async I/O, `gh` CLI interop |
| TUI Framework | **Ink v4** (React for terminals) | Component model, reusable panels, easier state |
| Remote comms | **ws** (WebSocket) + **ssh2** | Agent bridge for OpenClaw and future agents |
| GitHub API | **Octokit** + `gh` CLI subprocess | Octokit for structured data; `gh` for convenience |
| Git | **simple-git** | Programmatic git without shelling out constantly |
| Process mgmt | **execa** | Spawn/manage claude, codex, openclaw processes |
| Config | **cosmiconfig** | Flexible config loading (JSON/YAML/JS) |
| State | **Zustand** (in-process) | Predictable state for TUI panels |
| Logging | **pino** | Structured logs to file, not stdout (avoids TUI conflicts) |
| Testing | **Vitest** | Fast, ESM-native unit tests |
| Type safety | **TypeScript 5** | Required for all source files |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      NEXUS TUI (Ink)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Agents  │  │  Tasks   │  │   Git    │  │  Log   │  │
│  │  Panel   │  │  Panel   │  │  Panel   │  │ Panel  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
└───────┼─────────────┼──────────────┼─────────────┼───────┘
        │             │              │             │
┌───────▼─────────────▼──────────────▼─────────────▼───────┐
│                    NEXUS Core Services                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Agent    │  │    Task      │  │   GitHub / Git   │  │
│  │  Manager   │  │   Engine     │  │     Service      │  │
│  └─────┬──────┘  └──────┬───────┘  └─────────┬────────┘  │
└────────┼────────────────┼──────────────────────┼──────────┘
         │                │                      │
  ┌──────▼──────┐  ┌──────▼──────┐     ┌────────▼────────┐
  │   Agent     │  │  Issue /    │     │  Octokit API    │
  │  Adapters   │  │  PR Queue   │     │  + gh CLI       │
  │  (claude,   │  └─────────────┘     └─────────────────┘
  │   codex,    │
  │  openclaw)  │
  └──────┬──────┘
         │
  ┌──────▼────────────────┐
  │   Agent Bridge         │
  │  (local process /      │
  │   SSH / WebSocket)     │
  └────────────────────────┘
```

---

## 4. Phase Breakdown

### Phase 0 — Scaffolding (Week 1)
- [ ] Initialize TypeScript + Ink project
- [ ] Set up eslint, prettier, vitest
- [ ] Implement config loader (`nexus.config.json`)
- [ ] Basic TUI shell with placeholder panels
- [ ] File logger (pino) separated from TUI stdout

### Phase 1 — Git & GitHub Integration (Week 2)
- [ ] `GitService`: branch list, status, diff, log tail
- [ ] `GitHubService`: list issues, create issue, list PRs, get PR status
- [ ] Git panel in TUI showing active branch + dirty files
- [ ] Issues panel listing open issues + labels

### Phase 2 — Local Agent Sessions (Week 3)
- [ ] `AgentAdapter` interface and base class
- [ ] `ClaudeAdapter`: spawn `claude` CLI in a workdir, capture output
- [ ] `CodexAdapter`: spawn `codex` CLI in a workdir, capture output
- [ ] Agents panel: list sessions, status indicators
- [ ] Session log viewer per agent

### Phase 3 — Remote Agent Bridge (Week 4)
- [ ] `BridgeServer`: WebSocket server (for OpenClaw to connect to NEXUS)
- [ ] `BridgeClient`: WebSocket client (NEXUS connects to remote OpenClaw)
- [ ] SSH tunnel option for secure remote connections
- [ ] `OpenClawAdapter`: wraps bridge connection as an agent
- [ ] Connect N remote agents dynamically from config or TUI command

### Phase 4 — Task Assignment Engine (Week 5)
- [ ] `Task` data model (maps to GitHub Issue)
- [ ] `TaskQueue`: priority queue with agent/human assignment
- [ ] Manual assignment via TUI command palette
- [ ] Auto-assignment rules (keyword routing, workdir matching)
- [ ] Task status sync with GitHub (open → in_progress → review → done)

### Phase 5 — PR Enforcement & Sub-repos (Week 6)
- [ ] Agent wrapper: auto-create branch → commit → push → open PR
- [ ] PR template generator per task type
- [ ] Sub-repo support: detect and register nested git repos
- [ ] Sub-repo selector in TUI (switch context between repos)
- [ ] Aggregate view: PRs across all subrepos

### Phase 6 — Human Contributors (Week 7)
- [ ] `ContributorRegistry`: load from GitHub collaborators API
- [ ] Human contributor panel: name, avatar (ASCII), current assignment
- [ ] Assign issue to human contributor via TUI
- [ ] Notification stub: post a GitHub comment when assigning to human

### Phase 7 — Polish & Hardening (Week 8)
- [ ] Keyboard shortcut help overlay
- [ ] Config validation with friendly error messages
- [ ] Reconnect logic for dropped remote agents
- [ ] End-to-end integration tests
- [ ] Full README and docs
- [ ] `npm pack` / release prep

---

## 5. Module Specifications

### 5.1 `AgentManager`
Responsible for lifecycle of all agent sessions.

```typescript
interface AgentManager {
  register(config: AgentConfig): void;
  connect(agentId: string): Promise<void>;
  disconnect(agentId: string): Promise<void>;
  dispatch(agentId: string, task: Task): Promise<void>;
  listAgents(): AgentSession[];
  onStatusChange(cb: (agentId: string, status: AgentStatus) => void): void;
}
```

### 5.2 `TaskEngine`
Routes tasks from the queue to agents or humans.

```typescript
interface TaskEngine {
  enqueue(task: Task): void;
  assign(taskId: string, assignee: AgentId | ContributorId): void;
  autoAssign(task: Task): Assignee;
  getQueue(): Task[];
  onComplete(taskId: string, result: TaskResult): void;
}
```

### 5.3 `GitHubService`
Wraps Octokit for all GitHub operations.

```typescript
interface GitHubService {
  getIssues(filters?: IssueFilters): Promise<Issue[]>;
  createIssue(input: CreateIssueInput): Promise<Issue>;
  createPR(input: CreatePRInput): Promise<PR>;
  getPRStatus(prNumber: number): Promise<PRStatus>;
  getCollaborators(): Promise<Contributor[]>;
  addComment(issueNumber: number, body: string): Promise<void>;
}
```

### 5.4 `BridgeServer / BridgeClient`
Handles bidirectional messaging with remote agents.

**Message envelope:**
```json
{
  "id": "uuid-v4",
  "type": "TASK_DISPATCH | STATUS_UPDATE | LOG_LINE | PING | AUTH",
  "agentId": "openclaw-remote-1",
  "payload": {}
}
```

---

## 6. Data Models

```typescript
// Agent
type AgentType = 'claude' | 'codex' | 'openclaw';
type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected';

interface AgentConfig {
  id: string;
  type: AgentType;
  workdir?: string;           // for local agents
  host?: string;              // for remote agents
  port?: number;
  transport?: 'ssh' | 'websocket';
  autopr: boolean;
}

interface AgentSession extends AgentConfig {
  status: AgentStatus;
  currentTask?: string;       // task ID
  pid?: number;               // local process PID
  connectedAt?: Date;
  lastSeen?: Date;
}

// Task (maps to GitHub Issue)
type TaskStatus = 'backlog' | 'assigned' | 'in_progress' | 'review' | 'done';
type AssigneeType = 'agent' | 'human';

interface Task {
  id: string;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  status: TaskStatus;
  assigneeId?: string;
  assigneeType?: AssigneeType;
  repoPath: string;           // which subrepo this belongs to
  prNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Contributor (human)
interface Contributor {
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  currentTaskId?: string;
  role: 'owner' | 'maintainer' | 'contributor';
}

// SubRepo
interface SubRepo {
  name: string;
  path: string;               // relative to workspace root
  remote?: string;
  branch?: string;
  isDirty?: boolean;
}
```

---

## 7. Agent Communication Protocol

All agents (local and remote) communicate via a unified message protocol.

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `AUTH` | client→server | Authenticate with shared secret |
| `AUTH_ACK` | server→client | Authentication confirmed |
| `TASK_DISPATCH` | nexus→agent | Send a task to an agent |
| `TASK_ACK` | agent→nexus | Agent accepted the task |
| `STATUS_UPDATE` | agent→nexus | Agent status changed |
| `LOG_LINE` | agent→nexus | Streaming log output |
| `TASK_COMPLETE` | agent→nexus | Task finished, includes PR URL |
| `PING` / `PONG` | both | Keepalive heartbeat (30s) |

### PR Enforcement Flow
```
NEXUS dispatches task
       ↓
Agent creates branch: nexus/task-{issueNumber}-{slug}
       ↓
Agent performs work, commits with message: "feat: {task title} [closes #{issueNumber}]"
       ↓
Agent pushes branch to remote
       ↓
Agent calls GitHubService.createPR(...)
       ↓
Agent sends TASK_COMPLETE with { prUrl, prNumber }
       ↓
NEXUS updates task status → 'review'
       ↓
NEXUS posts comment on issue: "PR opened: {prUrl}"
```

---

## 8. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  NEXUS  v1.0   workspace: /projects/myapp   branch: main  ●dirty    │
├─────────────────────────┬───────────────────────────────────────────┤
│  AGENTS & CONTRIBUTORS  │  TASKS                                     │
│                         │                                            │
│  ● claude-local  [idle] │  #42  Fix auth bug           [claude-local]│
│  ● codex-api     [work] │  #43  Add pagination          [codex-api]  │
│  ⚡ openclaw-1  [work]  │  #44  Update docs             [dann]       │
│  ⚡ openclaw-2  [idle]  │  #45  Refactor DB layer       [backlog]    │
│                         │                                            │
│  👤 dann        [#44]   │  [ + New Issue ]  [ Assign ]  [ Refresh ] │
│  👤 collaborator [idle] │                                            │
├─────────────────────────┼───────────────────────────────────────────┤
│  GIT STATUS             │  AGENT LOG                                 │
│                         │                                            │
│  ○ main (↑2 commits)    │  [codex-api] Creating branch...            │
│  M  src/auth/login.ts   │  [codex-api] Committing changes...         │
│  M  src/api/users.ts    │  [codex-api] Opening PR #67...             │
│  ?  src/utils/new.ts    │  [openclaw-1] Received task #42            │
│                         │  [openclaw-1] Reading codebase...          │
│  SUBREPOS               │                                            │
│  ● packages/frontend    │                                            │
│  ○ packages/api  [✓]    │                                            │
├─────────────────────────┴───────────────────────────────────────────┤
│  > _   [?] Help  [c] Connect Agent  [i] New Issue  [q] Quit         │
└─────────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `c` | Connect new agent |
| `i` | Create new GitHub issue |
| `a` | Assign selected task |
| `d` | Disconnect selected agent |
| `r` | Refresh all data |
| `l` | Focus agent log panel |
| `s` | Switch subrepo context |
| `p` | Open PR list |
| `?` | Help overlay |
| `q` | Quit |

---

## 9. GitHub & Git Integration

### GitHub Operations (via Octokit + `gh`)
- List open issues with labels and assignees
- Create issue from TUI (title, body, labels)
- List open PRs and their CI status
- Assign issues to GitHub users
- Post comments on issues (task assignments, completion notices)
- Fetch repository collaborators

### Git Operations (via simple-git)
- Current branch name
- Dirty working tree (modified/untracked files)
- Ahead/behind count vs. remote
- Recent commit log (last 10)
- Sub-repo detection (walk directories for `.git`)
- Branch creation for agent tasks

### Auto PR Branch Naming Convention
```
nexus/task-{issueNumber}-{kebab-title}
# Example:
nexus/task-42-fix-auth-token-refresh
```

---

## 10. Task Assignment Engine

### Auto-Assignment Rules (evaluated in order)

1. **Label match** — If issue has label `claude`, assign to a `claude` agent
2. **Label match** — If issue has label `codex`, assign to a `codex` agent
3. **Workdir match** — If issue body mentions a subrepo path, assign to agent configured for that path
4. **Load balance** — Assign to idle agent of any type
5. **Human fallback** — If no agents are idle, flag for human review

### Manual Override
Any task can be manually assigned via the TUI regardless of auto-assignment rules. Manual assignments are persisted in `.nexus/assignments.json` locally.

---

## 11. Security Considerations

- **Remote agent auth** — All bridge connections require a `NEXUS_BRIDGE_SECRET` shared secret (env var), validated on `AUTH` message before any task dispatch
- **SSH tunneling** — Remote agents should prefer SSH tunnel over raw WebSocket for production use
- **GitHub tokens** — Stored in `.env` only, never committed. Use fine-grained PATs with minimum required scopes (`repo`, `issues`, `pull_requests`)
- **No secrets in logs** — Log sanitization middleware strips tokens and keys from all log lines
- **Agent isolation** — Each local agent session runs in its own process with its own working directory

---

## 12. Testing Strategy

| Level | Tool | Coverage Target |
|-------|------|-----------------|
| Unit | Vitest | Core services, data models, routing logic |
| Integration | Vitest + mock `gh` | GitHub/Git service with mocked CLI |
| E2E (manual) | — | Full TUI launch, agent connect, task dispatch |
| Agent bridge | Vitest | WebSocket protocol message handling |

### Critical Test Cases
- Agent connect/disconnect/reconnect cycle
- Task dispatch → PR creation flow
- GitHub issue creation and label assignment
- Auto-assignment rule ordering
- Sub-repo detection and context switching
- Bridge auth rejection on wrong secret

---

## 13. Milestones & Timeline

| Milestone | Target | Deliverable |
|-----------|--------|-------------|
| M0 — Scaffold | Week 1 | Runnable shell with config loading |
| M1 — Git/GH | Week 2 | Panels showing live git + issues data |
| M2 — Local Agents | Week 3 | Claude + Codex sessions spawnable from TUI |
| M3 — Remote Bridge | Week 4 | OpenClaw connectable over WebSocket |
| M4 — Task Engine | Week 5 | Issues assignable, queue tracking works |
| M5 — PR Enforcement | Week 6 | All agent commits go through PRs |
| M6 — Human Contributors | Week 7 | Humans visible and assignable in TUI |
| M7 — v1.0 Release | Week 8 | Docs complete, tested, published |

---

## 14. Open Questions

- [ ] Should NEXUS support a config UI (wizard on first run) or always require manual `nexus.config.json`?
- [ ] Do we want an optional web mirror of the TUI dashboard (Phase 2)?
- [ ] Should task auto-assignment use LLM analysis of issue body for smarter routing?
- [ ] What is the escalation path when an agent fails mid-task? (retry, reassign, alert human)
- [ ] OpenClaw-specific: does it have an existing API/protocol we must conform to, or can we define the bridge spec?
