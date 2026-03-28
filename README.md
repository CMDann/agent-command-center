# NEXUS
### Agent Command Center (early scaffold)

```
███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

**NEXUS** is a terminal dashboard (Ink/React) intended to coordinate AI coding agents and human contributors.

This repository is currently in an **early scaffold phase**: the TUI layout and core services exist, but many “big vision” features are not wired end-to-end yet.

---

## Current status (reality check)

What you can expect **today**:

- A running Ink-based TUI with panels for:
  - **Git status** (branch + dirty state + file lists)
  - **Sub-repo detection** (best-effort scan for nested git repos)
  - **GitHub issues** panel (requires env vars)
  - **Agents panel** (local agent sessions)
  - **Log panel**
- TypeScript project scaffold with lint/typecheck/tests.

What is **planned / in-progress** (not fully implemented or not hooked up):

- Remote agent connections (SSH/WebSocket bridge)
- Intelligent task routing / assignment policies
- PR enforcement / “all agent commits go through PRs” automation
- Rich contributor management beyond basic GitHub collaborator data

If you’re evaluating the project: treat it as a solid starting point and UI skeleton, not a finished orchestration platform.

---

## Implemented features (now)

- **Local agent sessions (WIP)** — connect to local `claude` or `codex` CLIs from the TUI
- **Git status** — status + staged/modified/untracked lists
- **GitHub issues panel** — list open issues via Octokit (requires `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`)
- **Config loader** — loads `nexus.config.json` with schema validation

## Planned features

- **Remote agents** — OpenClaw agents on other machines via a secure bridge
- **Task lifecycle automation** — issue → branch → PR → checks → merge workflows
- **Multi-repo workspaces** — richer sub-repo mapping + context switching
- **Policy & guardrails** — configurable rules for what agents may do

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20.x | Runtime |
| `git` | ≥ 2.x | Version control |
| (optional) `gh` CLI | ≥ 2.x | Convenience for humans (not required for the running scaffold) |
| (optional) `claude` CLI | latest | Local Claude agent sessions |
| (optional) `codex` CLI | latest | Local Codex agent sessions |

---

## Quick start (verifiably runnable)

```bash
git clone https://github.com/CMDann/agent-command-center.git
cd agent-command-center

npm install

# Optional: enable GitHub Tasks panel
cp .env.example .env
# Edit .env with your GitHub repo coordinates and tokens (never commit .env)
# Required for the Tasks panel: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO

npm start
```

### Notes

- Without the GitHub env vars, the Tasks panel will show a friendly “not configured” message.
- Without the `claude` / `codex` CLIs installed, you can still run the TUI, but connecting agents will fail.

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

## Project layout (current)

```
src/
  agents/       # agent adapters + session manager (local adapters today)
  config/       # config schema + loader
  git/          # git service used by the UI
  github/       # GitHub service (Octokit)
  ui/           # Ink UI components (panels + modal)
  utils/        # logger, helpers
```

---

## License

MIT — see [LICENS.md](./LICENS.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
