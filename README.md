# NEXUS
### Multi-Agent Terminal Orchestration Platform — v1.0.0

```
███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

**NEXUS** is a terminal-based multi-agent orchestration dashboard. It unifies AI coding
agents (Claude Code, OpenCodex, OpenClaw), GitHub issue management, Git tracking, and
human contributor coordination into a single keyboard-driven TUI.

---

## Screenshot

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ NEXUS v1.0.0 — multi-agent orchestration dashboard   [?] Help  [q] Quit       │
├──────────────────────────────────┬─────────────────────────────────────────────┤
│ AGENTS & CONTRIBUTORS            │ TASKS (3)                                   │
│  agents                          │                                             │
│▶ ● claude-local     [idle]       │▶ #  7 Fix login timeout    [in_prog] claude │
│  ● codex-local      [working]    │  #  3 Add dark mode        [assigned] bob   │
│    issue-12                      │  #  1 Update README        [backlog]        │
│  contributors                    │                                             │
│  👤 alice           [owner]      │ [↑↓] select  [a] assign  [Enter] dispatch  │
│  👤 bob             [contributor]│ [i] new issue                               │
│    issue-3                       │                                             │
│ [↑↓] navigate  [d] disconnect    │                                             │
│ [Enter] detail  [c] connect      │                                             │
├──────────────────────────────────┼─────────────────────────────────────────────┤
│ GIT STATUS                       │ AGENT LOG [codex-local]                     │
│ branch: main                     │ [codex-local] Connected                     │
│ modified: 2  staged: 1           │ [codex-local] Created branch:               │
│                                  │   nexus/task-12-fix-login-timeout           │
│ sub-repos                        │ [codex-local] Pushed branch                 │
│  ▶ packages/api  [main] dirty    │ [codex-local] Opened PR #34:                │
│    packages/web  [main]          │   https://github.com/org/repo/pull/34       │
│                                  │ [codex-local] Task complete                 │
│ [r] refresh  [s] set context     │                                             │
└──────────────────────────────────┴─────────────────────────────────────────────┘
```

---

## Features

- **Multi-agent support** — Connect Claude Code, OpenCodex, and remote OpenClaw agents simultaneously
- **Remote bridge** — SSH/WebSocket bridge with HMAC-SHA256 challenge-response auth and exponential-backoff reconnect
- **GitHub integration** — Sync issues as tasks; create issues, PRs, and comments via write service
- **PR enforcement** — Every agent task automatically results in a feature branch + pull request
- **Human contributors** — Track GitHub collaborators alongside agents; assign tasks to people with one keypress
- **Sub-repo support** — Manage monorepos and multi-repo workspaces; filter tasks by sub-repo context
- **Intelligent assignment** — Label-based and workdir-based auto-assignment rules
- **Error-resilient TUI** — Each panel is independently error-bounded; a crash reloads only that panel
- **Secret-safe logging** — Two-layer redaction: field-path + regex patterns for tokens, JWTs, Bearer headers

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20.x | Runtime |
| `git` | ≥ 2.x | Version control |
| `claude` CLI | latest | Claude Code agent sessions |
| `codex` CLI | latest | OpenCodex agent sessions |
| SSH / network access | — | Remote OpenClaw agents |

GitHub integration requires a personal access token with `repo` scope set as `GITHUB_TOKEN`.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/CMDann/agent-command-center.git
cd agent-command-center
npm install

# 2. Configure environment
cp .env.example .env
# Fill in: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
# Optional: NEXUS_BRIDGE_SECRET or NEXUS_BRIDGE_TOKENS for remote agents

# 3. Create nexus.config.json (see Configuration below)

# 4. Run in development
npm start

# 5. Or build and run the bundled CLI
npm run build
node dist/nexus.js
# Or after npm install -g: nexus
```

### Developer commands

```bash
npm run lint        # ESLint (zero warnings)
npm run typecheck   # tsc --noEmit (strict type check)
npm test            # Vitest unit tests
npm run coverage    # Test coverage report
npm run build       # tsc type-check + esbuild single-file bundle → dist/nexus.js
npm run smoke       # Startup smoke test (exits immediately after init)
```

---

## Configuration

Create `nexus.config.json` in your project root:

```json
{
  "workspace": "/path/to/your/project",
  "github": {
    "owner": "your-org",
    "repo":  "your-repo"
  },
  "agents": [
    {
      "id":      "claude-local",
      "type":    "claude",
      "workdir": "./",
      "autopr":  true
    },
    {
      "id":        "openclaw-remote",
      "type":      "openclaw",
      "host":      "192.168.1.100",
      "port":      7777,
      "transport": "websocket"
    }
  ],
  "repos": [
    { "name": "frontend", "path": "./packages/frontend" },
    { "name": "api",      "path": "./packages/api" }
  ]
}
```

**Environment variables** (keep secrets out of `nexus.config.json`):

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes (for mutations) | PAT with `repo` scope |
| `GITHUB_OWNER` | Yes | Repository owner login |
| `GITHUB_REPO` | Yes | Repository name |
| `NEXUS_BRIDGE_SECRET` | For remote agents | Shared secret (single-token legacy) |
| `NEXUS_BRIDGE_TOKENS` | For remote agents | `id=secret,id2=secret2` pairs |
| `NEXUS_CONFIG_PATH` | No | Override config file location |
| `LOG_LEVEL` | No | Pino log level (default: `debug`) |

---

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `?` | Global | Toggle help overlay |
| `c` | Global | Connect a new agent |
| `i` | Global | Create a new GitHub issue |
| `q` | Global | Quit NEXUS |
| `↑` / `↓` | Tasks / Agents panels | Navigate list |
| `a` | Tasks panel | Assign selected task |
| `Enter` | Tasks panel | Dispatch task to assigned agent |
| `d` | Agents panel | Disconnect selected agent |
| `Enter` | Agents panel (contributor) | Open contributor detail |
| `r` | Git panel | Refresh git status |
| `s` | Git panel | Set active sub-repo context |
| `Escape` | Any modal | Close / cancel |
| `r` | Error panel | Reload crashed panel |

---

## Remote Bridge Authentication

Remote OpenClaw agents connect over WebSocket with a challenge-response handshake:

1. Server → client: `AUTH_CHALLENGE` with a random nonce
2. Client → server: `AUTH` with HMAC-SHA256 signature over `tokenId.challenge.clientNonce.clientTimeMs`
3. Server → client: `AUTH_ACK` on success

The shared secret is **never sent over the wire**.

Set one of:
- `NEXUS_BRIDGE_TOKENS=laptop=supersecret,ci=anothersecret` (preferred, multi-token)
- `NEXUS_BRIDGE_SECRET=supersecret` (legacy, single token)

---

## Architecture

```
src/
├── agents/        AgentAdapter (base), ClaudeAdapter, CodexAdapter,
│                  OpenClawAdapter, AgentPRWrapper, AgentManager
├── bridge/        BridgeServer, BridgeClient, protocol, auth, tokens
├── config/        ConfigLoader (cosmiconfig + Zod), schema, loadConfig
├── contributors/  ContributorRegistry (GitHub collaborators + refresh)
├── git/           GitService (simple-git)
├── github/        GitHubService (read), GitHubWriteService (write)
├── tasks/         TaskEngine (queue + assignment rules), TaskSync
├── types.ts       Shared data models
├── ui/
│   ├── App.tsx    Root component, modal state machine, error boundaries
│   ├── ErrorBoundary.tsx
│   ├── hooks/     useAgentStore, useTaskStore, useGitStore,
│   │              useContributorStore, useGitHubStore
│   ├── modals/    ConnectAgent, AssignTask, NewIssue,
│   │              ContributorDetail, Help
│   └── panels/    Agents, Tasks, Git, Log
└── utils/         logger (pino), sanitize (secret redaction)
```

---

## License

MIT — See [LICENSE.md](./LICENSE.md)
