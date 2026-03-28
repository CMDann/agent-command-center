# Contributing to NEXUS

Thank you for your interest in contributing to NEXUS! This document covers how to contribute code, report issues, and work alongside the AI agents that co-develop this project.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Development Workflow](#3-development-workflow)
4. [Issue Guidelines](#4-issue-guidelines)
5. [Pull Request Guidelines](#5-pull-request-guidelines)
6. [Working Alongside AI Agents](#6-working-alongside-ai-agents)
7. [Review Process](#7-review-process)
8. [Release Process](#8-release-process)

---

## 1. Code of Conduct

All contributors — human and AI — are expected to:

- Treat all contributors with respect
- Give constructive, specific feedback in code reviews
- Avoid scope creep in PRs — one concern per PR
- Document decisions in issue or PR comments so the full team (including agents) has context
- Never merge PRs that fail tests or linting

---

## 2. Getting Started

### Prerequisites

Ensure you have:
- Node.js 20+
- `gh` CLI authenticated (`gh auth login`)
- `git` configured with your name and email
- Optional: `claude` CLI or `codex` CLI for running agents locally

### Setup

```bash
git clone https://github.com/your-org/nexus.git
cd nexus
npm install
cp .env.example .env
# Edit .env with your GITHUB_TOKEN and optionally NEXUS_BRIDGE_SECRET
npm start
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run coverage      # Coverage report
```

### Linting, Type Checking, and Smoke Checks

```bash
npm run lint          # ESLint (repo-wide)
npm run typecheck     # TypeScript typecheck (no emit)
npm run build         # Build to dist/
npm run smoke         # Non-interactive startup check (CI-friendly)
```

### Formatting

```bash
npm run format        # Prettier auto-format
npm run format:check  # Verify formatting (no changes)
```

---

## 3. Development Workflow

NEXUS uses a **trunk-based development** model with short-lived feature branches.

```
main (protected)
  └── feat/contributor-panel        ← human feature branch
  └── nexus/task-42-fix-auth        ← AI agent branch (auto-named)
  └── fix/bridge-reconnect          ← human bugfix branch
```

### Step-by-Step

1. **Find or create an issue** — All work starts with a GitHub issue
2. **Create a branch** — Follow naming conventions in `CODING_STANDARDS.md`
3. **Make changes** — Keep commits small and focused
4. **Test locally** — All tests must pass before opening a PR
5. **Open a PR** — Reference the issue, fill in the PR template
6. **Respond to review** — Address all comments before requesting re-review
7. **Merge** — Squash merge to keep main history clean

---

## 4. Issue Guidelines

### Before Opening an Issue

- Search existing issues to avoid duplicates
- If it's a bug, try to reproduce it with minimal steps
- If it's a feature, check the roadmap in `IMPLEMENTATION_PLAN.md` first

### Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Something is broken |
| `feat` | New feature request |
| `docs` | Documentation improvement |
| `claude` | Suitable for Claude Code agent |
| `codex` | Suitable for OpenCodex agent |
| `openclaw` | Suitable for OpenClaw remote agent |
| `human` | Requires human judgment |
| `blocked` | Waiting on another issue or external factor |
| `good first issue` | Low complexity, good for new contributors |

### Writing a Good Issue

```markdown
## Summary
One sentence describing the problem or feature.

## Context
Why does this matter? What's the impact?

## Steps to Reproduce (for bugs)
1. Step 1
2. Step 2
3. Observed: ...
4. Expected: ...

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
Any additional context, links, or constraints.
```

---

## 5. Pull Request Guidelines

### PR Title Format
```
[Type] Short description (#issueNumber)
```
Examples:
```
[feat] Add OpenClaw remote agent adapter (#23)
[fix] Reconnect logic on bridge auth failure (#31)
[docs] Update configuration reference (#18)
```

### PR Body Template

```markdown
## Summary
What does this PR do?

## Changes
- Added X
- Updated Y
- Fixed Z

## Testing
How was this tested? What tests were added?

## Screenshots / Output
(Optional) TUI screenshot or relevant log output

Closes #issueNumber
```

### PR Rules

- **One issue per PR** — Don't bundle unrelated changes
- **All CI checks must pass** — lint, typecheck, tests
- **No direct pushes to `main`** — this branch is protected
- **Keep PRs small** — under 400 lines of change is ideal
- **AI agent PRs** are tagged `[NEXUS]` automatically — these follow the same rules

---

## 6. Working Alongside AI Agents

NEXUS is partially developed by AI coding agents. Here's what that means for human contributors:

### Agent-Opened PRs

When an agent opens a PR:
- The PR title will be prefixed with `[NEXUS]`
- The branch will follow the pattern `nexus/task-{issue}-{slug}`
- A comment on the original issue will link to the PR

Human contributors should:
- Review agent PRs with the same rigour as human PRs
- Leave specific, actionable review comments (agents can read and act on them)
- Approve or request changes via GitHub's review system — agents will pick this up

### Assigning Work to Agents vs. Humans

Use labels to signal intent:
- Add `claude`, `codex`, or `openclaw` to route to that agent type
- Add `human` for tasks requiring judgment, design decisions, or external communication
- Untagged issues enter the auto-assignment pool

### Reviewing Agent Work

Agents are good at:
- Implementing well-specified features with clear acceptance criteria
- Writing tests for existing code
- Refactoring with clear before/after expectations
- Fixing bugs with reproducible steps

Be more careful reviewing agent work that involves:
- Security-sensitive code (auth, secrets handling)
- Complex algorithmic decisions
- UX/interaction design choices
- Integration with external services

---

## 7. Review Process

### For Human PRs
- At least **1 approval** from a maintainer required
- Author cannot approve their own PR
- Stale reviews (>7 days with no activity) will be pinged

### For Agent PRs
- At least **1 human approval** required
- CI must pass
- Maintainer may use "auto-merge on approval" for low-risk agent PRs

### Review Etiquette

```
# ✅ Good review comment
"This reconnect logic will retry indefinitely if the host is valid but the 
secret is wrong. Consider adding a max retry count for auth failures specifically 
(separate from network failures)."

# ❌ Not helpful
"This looks wrong."
```

Prefix comments with:
- **`nit:`** — Minor style preference, not blocking
- **`question:`** — Genuine question, not necessarily a change request
- **`blocking:`** — Must be addressed before merge
- **`suggestion:`** — Optional improvement

---

## 8. Release Process

Releases follow [Semantic Versioning](https://semver.org/):
- **MAJOR** — breaking changes to config format or CLI interface
- **MINOR** — new features, new agent adapters
- **PATCH** — bug fixes, performance improvements

### Release Steps

1. Update `CHANGELOG.md` with all changes since last release
2. Bump version in `package.json`
3. Open a PR titled `[release] vX.Y.Z`
4. After merge: tag the commit `vX.Y.Z` on main
5. GitHub Actions will publish to npm automatically

### CHANGELOG Format

```markdown
## [1.1.0] — 2026-05-01

### Added
- SSH tunnel support for remote agent bridge (#45)
- Contributor detail view in TUI (#52)

### Fixed  
- Bridge reconnect not triggering after clean disconnect (#48)

### Changed
- Auto-assignment now prefers agents by workdir match before label match (#50)
```
