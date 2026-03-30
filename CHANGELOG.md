# Changelog

All notable changes to NEXUS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — 2026-03-28

First stable release of NEXUS — a multi-agent terminal orchestration dashboard.

### Added

#### Phase 0 — Scaffold
- TypeScript 5 + Ink 4 (React) TUI scaffold with `tsx` dev runner
- ESLint + Prettier + Vitest test harness; CI-friendly `--max-warnings=0`
- `nexus.config.json` schema with Zod; `ConfigLoader` with cosmiconfig search

#### Phase 1 — Core Services
- `GitService` (simple-git): status, branch, commits-ahead, sub-repo detection
- `GitHubService` (Octokit, read-only): list issues, list/get PRs, CI checks status
- `GitHubWriteService` (Octokit, write): create issues, create PRs, add comments,
  add/remove issue assignees
- Two-layer log redaction: Pino field-path `redact` + pattern-based `sanitizeLogObject`
  covering GitHub PATs, JWTs, Bearer tokens, AWS key IDs, and more

#### Phase 2 — TUI Panels
- 2×2 dashboard layout: Agents & Contributors, Tasks, Git Status, Agent Log
- Keyboard navigation (↑/↓), status colour-coding, selection indicators
- `useAgentStore`, `useTaskStore`, `useGitStore`, `useGitHubStore` Zustand stores

#### Phase 3 — Agent Adapters
- `AgentAdapter` abstract base with `connect/disconnect/dispatch` lifecycle
- `ClaudeAdapter` — spawns `claude` CLI subprocess
- `CodexAdapter` — spawns `codex` CLI subprocess
- `OpenClawAdapter` — server mode (bridge listener) + client mode (WebSocket/SSH)
- `AgentManager` singleton managing registration, lifecycle, and log ring-buffer

#### Phase 4 — Remote Bridge
- `BridgeServer` WebSocket server with HMAC-SHA256 challenge-response auth
- `BridgeClient` with exponential-backoff reconnect (1 s → 2 → 4 → 8 → 16 s);
  after 5 failed attempts marks agent `disconnected` with TUI alert
- SSH tunnel support via `ssh2` (`openSshTunnel`)
- Token registry: `NEXUS_BRIDGE_TOKENS` (multi-token) + `NEXUS_BRIDGE_SECRET` fallback

#### Phase 5 — PR Enforcement & Sub-repo Support
- `AgentPRWrapper` decorator: pre-dispatch branch creation, post-complete PR open,
  issue comment, task transition to `review`
- `GitService.createBranch / pushBranch / getCommitsAheadOf`
- Sub-repo detection in `useGitStore`; Tasks panel filtered by active sub-repo
- New Issue modal: target sub-repo selector for multi-repo workspaces

#### Phase 6 — Human Contributor Management
- `ContributorRegistry`: fetches GitHub collaborators, 5-min refresh,
  tracks `currentTaskId` from open issue assignments
- `useContributorStore` Zustand store subscribing to registry update events
- Unified Agents & Contributors panel: agents (working→idle→error→disconnected)
  + contributors (active-task-first), Enter → detail view
- `AssignTaskModal`: contributors in numbered list; human assignment calls
  `addAssignee` + posts `👤 Assigned to @{login} via NEXUS` comment
- `ContributorDetailModal`: profile, role, open assigned issues; `[r]` to refresh

#### Phase 7 — Polish & v1.0.0 Release
- **Help overlay** (`?` key): full-screen keyboard shortcut reference; dismiss with
  `Escape` or `?`
- **Error boundaries**: each panel wrapped in `ErrorBoundary`; a crashing panel shows
  `[Panel Error — press r to reload]` instead of killing the TUI
- **Enhanced log sanitization** (`src/utils/sanitize.ts`): pattern-based redaction of
  GitHub PATs, fine-grained PATs, OAuth tokens, GitLab PATs, JWTs, HTTP Bearer
  headers, OpenAI-style keys, and AWS access key IDs; integrated into Pino via
  `formatters.log`
- **Reconnect UX**: BridgeClient max-retries now marks agent `disconnected` (not
  `error`) with clear TUI log message and `[c]` reconnect hint
- **Single-file bundle**: `npm run build` runs `tsc` type-check then `esbuild`
  to produce `dist/nexus.js` with `#!/usr/bin/env node` shebang; `bin.nexus`
  in `package.json` enables `npx nexus` / global `npm install -g`
- Version bumped from 0.1.0 → 1.0.0

### Changed
- `AgentsPanel` renamed `onAgentSelect` callback pattern; now accepts
  `onContributorDetail` prop
- `TasksPanel.onAssign` callback signature extended with `issueNumber`
- Header hint bar updated to include `[?] Help`

---

## [0.1.0] — Initial scaffold (unreleased)

### Added
- Initial TypeScript + Ink scaffold; basic panel layout; config loader;
  Git service; GitHub service; local agent session scaffolding; Vitest setup

---

## Version History

| Version | Date       | Notes                     |
|---------|------------|---------------------------|
| 1.0.0   | 2026-03-28 | First stable release      |
| 0.1.0   | —          | Internal scaffold (never released) |
