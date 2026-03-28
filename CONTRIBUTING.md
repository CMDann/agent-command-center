# Contributing to NEXUS

Thanks for contributing! This repo is still in an early scaffold stage, so the most valuable contributions right now are:

- Tightening the developer experience (setup, scripts, docs)
- Small, test-backed increments to existing services and UI panels
- Converting “planned” docs into concrete, incremental milestones

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Development Workflow](#3-development-workflow)
4. [Issue Guidelines](#4-issue-guidelines)
5. [Pull Request Guidelines](#5-pull-request-guidelines)
6. [Working Alongside AI Agents](#6-working-alongside-ai-agents)
7. [Review Process](#7-review-process)

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

- Node.js 20+
- `git` configured with your name and email
- Optional: `gh` CLI authenticated (`gh auth login`)
- Optional: `claude` CLI or `codex` CLI for connecting local agents from the TUI

### Setup

```bash
git clone https://github.com/CMDann/agent-command-center.git
cd agent-command-center

npm install

# Optional: enable GitHub-backed Tasks panel
cp .env.example .env
# Edit .env with your GITHUB_TOKEN and repo coordinates

npm start
```

### Running checks

```bash
npm test              # vitest (one-shot)
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run build         # tsc emit (sanity check)
```

### Formatting

```bash
npm run format        # prettier --write src
```

---

## 3. Development Workflow

We use short-lived branches off `main`.

```
main
  └── feat/something-small
  └── fix/something-broken
  └── docs/something-unclear
```

### Step-by-step

1. **Find or create an issue** — All work starts with a GitHub issue
2. **Create a branch** — Prefer `feat/…`, `fix/…`, `docs/…`
3. **Make changes** — Keep commits small and focused
4. **Run checks locally** — `npm run lint && npm run typecheck && npm test`
5. **Open a PR** — Reference the issue
6. **Respond to review** — Address comments before requesting re-review

---

## 4. Issue Guidelines

### Before opening an issue

- Search existing issues to avoid duplicates
- If it’s a feature, check the current roadmap in [IMPLEMENTATION.md](./IMPLEMENTATION.md)

### Writing a good issue

```markdown
## Summary
One sentence describing the problem or feature.

## Context
Why does this matter? What's the impact?

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
Links, constraints, or references.
```

---

## 5. Pull Request Guidelines

### PR rules

- **One issue per PR** — don’t bundle unrelated changes
- **All checks must pass** — lint, typecheck, tests
- **Keep PRs small** — under ~400 lines of change is ideal

### Helpful PR body

```markdown
## Summary
What does this PR do?

## Changes
- Added X
- Updated Y
- Fixed Z

## Testing
How was this tested?

Fixes #issueNumber
```

---

## 6. Working Alongside AI Agents

This project experiments with AI-assisted development.

Today, that mostly means:

- Code is written with clear interfaces and tests so an agent can make safe, incremental changes.
- Issues are written with concrete acceptance criteria.

Planned automation (not guaranteed yet):

- Agent-opened PR conventions, labels, and routing rules
- Guardrails that restrict what agents may do without human review

When reviewing agent-authored changes:

- Hold them to the same standard as human PRs
- Prefer review comments that are specific and actionable

---

## 7. Review Process

- At least **1 approval** from a maintainer required
- CI (or local checks) must pass
- Prefer squash merges for a clean `main` history

---

## References

- Coding standards: [CODINGSTANDARDS.md](./CODINGSTANDARDS.md)
- Implementation / roadmap: [IMPLEMENTATION.md](./IMPLEMENTATION.md)
