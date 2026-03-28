# NEXUS
### Multi-Agent Terminal Orchestration Platform

```
███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

**NEXUS** is a terminal-based multi-agent orchestration dashboard that unifies AI coding agents (Claude Code, OpenCodex, OpenClaw), GitHub project management, Git tracking, and human contributor coordination into a single TUI (Terminal User Interface).

---

## Features

- 🤖 **Multi-Agent Support** — Connect Claude Code, OpenCodex, and remote OpenClaw agents
- 🌐 **Remote Agent Connections** — SSH/WebSocket bridge for agents running on separate machines
- 📋 **GitHub Integration** — Issue creation, PR tracking, TODO management via `gh` CLI
- 🔀 **Git Tracking** — Local diff, branch, commit, and status monitoring
- 👥 **Human Contributor Management** — View, assign, and track human contributors alongside agents
- 📁 **Sub-repository Support** — Manage monorepos and multi-repo workspaces
- 🎯 **Intelligent Task Assignment** — Route tasks to the right agent or person based on context
- 🔄 **PR Enforcement** — All agent commits are automatically wrapped in pull requests

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20.x | Runtime |
| `gh` CLI | ≥ 2.x | GitHub integration |
| `git` | ≥ 2.x | Version control |
| `claude` CLI | latest | Claude Code sessions |
| `codex` CLI | latest | OpenCodex sessions |
| SSH access | — | Remote OpenClaw agents |

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/your-org/nexus.git
cd nexus

# Install dependencies
npm install

# Configure your environment
cp .env.example .env
# Edit .env with your GitHub repo coordinates and tokens (never commit .env)
# Required for the Tasks panel: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
# Optional for remote agents/bridge auth: NEXUS_BRIDGE_SECRET
# Optional explicit config path: NEXUS_CONFIG_PATH

# Launch NEXUS
npm start
```

### Developer checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
```

### Remote bridge auth (WebSocket)

Remote OpenClaw connections use a challenge-response auth handshake (HMAC-SHA256). The shared secret is **never sent over the wire**, and each connection includes a server challenge + client nonce for basic replay resistance.

Configure one of:

- `NEXUS_BRIDGE_TOKENS` (preferred): comma-separated `tokenId=secret` pairs
  - Example: `NEXUS_BRIDGE_TOKENS=openclaw-1=supersecret,ci=anothersecret`
- `NEXUS_BRIDGE_SECRET` (legacy fallback): single shared secret exposed as tokenId `default`

For the current MVP implementation, if a token exists for `agentId` it will be used; otherwise it falls back to `default`.

## Configuration

NEXUS is configured via `nexus.config.json` in your project root:

```json
{
  "workspace": "/path/to/your/project",
  "repos": [
    { "name": "frontend", "path": "./packages/frontend" },
    { "name": "api", "path": "./packages/api" }
  ],
  "agents": [
    {
      "id": "claude-local",
      "type": "claude",
      "workdir": "./",
      "autopr": true
    },
    {
      "id": "openclaw-remote",
      "type": "openclaw",
      "host": "192.168.1.100",
      "port": 7777,
      "transport": "websocket"
    }
  ]
}
```

GitHub repository coordinates and authentication are currently provided via environment variables (see `.env.example`).

---

## Configuration

NEXUS is configured via `nexus.config.json` in your project root.

Optionally set `NEXUS_CONFIG_PATH` to load a specific config file (supports `~` and relative paths).


```json
{
  "workspace": "/path/to/your/project",
  "github": {
    "owner": "your-org",
    "repo": "your-repo"
  },
  "agents": [
    {
      "id": "claude-local",
      "type": "claude",
      "workdir": "./",
      "autopr": true
    },
    {
      "id": "openclaw-remote",
      "type": "openclaw",
      "host": "192.168.1.100",
      "port": 7777,
      "transport": "websocket"
    }
  ],
  "repos": [
    { "name": "frontend", "path": "./packages/frontend" },
    { "name": "api",      "path": "./packages/api" }
  ]
}
```

---

## Remote Bridge Authentication (WebSocket)

Remote agents connecting over WebSocket must authenticate **before** any task messages are accepted.

This repo uses a minimal, secure challenge-response handshake:

1. Server → client: `AUTH_CHALLENGE` with a random `challenge` nonce
2. Client → server: `AUTH` with `{ tokenId, clientNonce, clientTimeMs, signature }`
3. Server → client: `AUTH_ACK` on success (otherwise closes the socket)

The `signature` is an HMAC-SHA256 over:

```
${tokenId}.${challenge}.${clientNonce}.${clientTimeMs}
```

The shared secret is **never sent over the wire**.

### Environment variables

Set one of:

- `NEXUS_BRIDGE_TOKENS` (preferred): comma-separated `tokenId=secret` pairs
  - Example: `NEXUS_BRIDGE_TOKENS=laptop=supersecret,ci=anothersecret`
- `NEXUS_BRIDGE_SECRET` (legacy fallback): single shared secret

> Do not put these values in `nexus.config.json`. Keep secrets in `.env`.

---

## Architecture

```
nexus/
├── src/
│   ├── ui/              # Blessed/Ink TUI components
│   ├── agents/          # Agent adapters (claude, codex, openclaw)
│   ├── bridge/          # SSH/WebSocket remote agent bridge
│   ├── github/          # gh CLI wrapper + Octokit client
│   ├── git/             # Local git integration (simple-git)
│   ├── tasks/           # Task queue and assignment engine
│   ├── contributors/    # Human contributor registry
│   └── config/          # Config loader and validator
├── nexus.config.json    # Project configuration
├── .env.example         # Environment variable template
└── docs/                # Extended documentation
```

---

## Key Concepts

### Agents
An **Agent** is any autonomous coding entity NEXUS can dispatch tasks to. Agents can be:
- **Local** — Running on the same machine (Claude Code, OpenCodex)
- **Remote** — Running on a separate host (OpenClaw via SSH/WebSocket)

### Tasks
A **Task** maps to a GitHub Issue. NEXUS can auto-generate tasks from natural language, assign them to agents or humans, and track their completion via PR status.

### Sessions
A **Session** is an active agent process bound to a working directory. Multiple sessions can run concurrently across different directories or subrepos.

---

## License

MIT — See [LICENSE.md](./LICENSE.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
