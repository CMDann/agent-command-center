# NEXUS — Coding Standards

> **Version:** 1.0  
> **Applies to:** All source files in `/src`, `/tests`  
> **Enforced by:** ESLint, TypeScript strict mode, Prettier  

---

## 1. Language & Runtime

- **TypeScript 5** is mandatory for all source files. No plain `.js` in `src/`
- **Node.js 20+** — use native `fetch`, `structuredClone`, top-level await where appropriate
- **ESM modules** — use `import/export`, not `require()`
- `tsconfig.json` must include `"strict": true` with no exceptions disabled

---

## 2. TypeScript Rules

### 2.1 No `any`
```typescript
// ❌ Bad
function process(data: any) { ... }

// ✅ Good
function process(data: unknown) {
  if (typeof data === 'string') { ... }
}
```

### 2.2 Explicit Return Types on Public Functions
```typescript
// ❌ Bad
async function getIssues() {
  return await octokit.issues.list(...)
}

// ✅ Good
async function getIssues(): Promise<Issue[]> {
  return await octokit.issues.list(...)
}
```

### 2.3 Prefer `interface` over `type` for Object Shapes
```typescript
// ✅ Preferred for objects
interface AgentSession {
  id: string;
  status: AgentStatus;
}

// ✅ Use type for unions, intersections, primitives
type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected';
```

### 2.4 Error Handling
All async functions must either:
- Catch and handle errors explicitly, OR
- Re-throw a typed custom error

```typescript
// ✅ Good — typed error propagation
class GitHubServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GitHubServiceError';
  }
}

async function createIssue(input: CreateIssueInput): Promise<Issue> {
  try {
    const { data } = await octokit.issues.create(input);
    return mapToIssue(data);
  } catch (err) {
    throw new GitHubServiceError(`Failed to create issue: ${String(err)}`, 422);
  }
}
```

### 2.5 Avoid Type Assertions Unless Unavoidable
```typescript
// ❌ Bad
const session = getSession() as AgentSession;

// ✅ Good — use a type guard
function isAgentSession(val: unknown): val is AgentSession {
  return typeof val === 'object' && val !== null && 'id' in val && 'status' in val;
}
```

---

## 3. File & Directory Organization

```
src/
├── agents/       # Agent adapters and manager
├── bridge/       # WebSocket/SSH bridge protocol
├── config/       # Config loading and validation
├── contributors/ # Human contributor registry
├── git/          # Git service
├── github/       # GitHub API service
├── tasks/        # Task engine and sync
├── ui/           # Ink TUI components
│   ├── panels/   # Individual panel components
│   ├── modals/   # Modal/overlay components
│   └── hooks/    # React hooks for TUI state
└── utils/        # Shared utilities (logger, uuid, etc.)
```

### File Naming Conventions
| Type | Convention | Example |
|------|-----------|---------|
| Classes / Services | PascalCase | `AgentManager.ts` |
| React components | PascalCase | `AgentsPanel.tsx` |
| Utilities | camelCase | `sanitizeLog.ts` |
| Types/interfaces | PascalCase | `types.ts` or colocated |
| Tests | Same name + `.test` | `AgentManager.test.ts` |
| Constants | SCREAMING_SNAKE | `DEFAULT_PORT = 7777` |

### One Class / Component Per File
Each file should export one primary class, function, or component. Shared types may be colocated or placed in a `types.ts` file per module.

---

## 4. Naming Conventions

| Thing | Style | Example |
|-------|-------|---------|
| Variables | camelCase | `agentSession` |
| Functions | camelCase | `connectAgent()` |
| Classes | PascalCase | `AgentManager` |
| Interfaces | PascalCase | `AgentSession` |
| Enums | PascalCase | `AgentStatus` |
| Enum values | PascalCase | `AgentStatus.Working` |
| Constants | SCREAMING_SNAKE | `MAX_RECONNECT_ATTEMPTS` |
| React components | PascalCase | `AgentsPanel` |
| CSS/Ink styles | camelCase object | `{ color: 'cyan' }` |

### Avoid Abbreviations
```typescript
// ❌ Bad
const ag = new AgMgr();
const cfg = loadCfg();

// ✅ Good
const agent = new AgentManager();
const config = loadConfig();
```

Acceptable abbreviations: `id`, `url`, `api`, `pr`, `ssh`, `tui`, `pid`

---

## 5. Git Conventions

### Commit Messages — Conventional Commits
```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

Types:
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code change with no feature/fix
- `test` — adding or updating tests
- `docs` — documentation only
- `chore` — build, config, deps
- `perf` — performance improvement

Examples:
```
feat(agents): add OpenClaw WebSocket adapter
fix(bridge): handle reconnect on auth failure
test(tasks): add auto-assignment rule unit tests
docs(readme): update agent configuration example
```

### Branch Naming
| Purpose | Pattern | Example |
|---------|---------|---------|
| NEXUS agent tasks | `nexus/task-{issue}-{slug}` | `nexus/task-42-fix-auth` |
| Human features | `feat/{slug}` | `feat/contributor-panel` |
| Bug fixes | `fix/{slug}` | `fix/bridge-reconnect` |
| Documentation | `docs/{slug}` | `docs/update-readme` |

### Pull Request Rules
- **All code to `main` must go through a PR** — no direct pushes
- PR title must follow: `[Type] Short description (#issueNumber)`
- PR body must reference the issue: `Closes #42`
- At least one approval required before merge (for human contributors)
- Agent PRs: can be auto-merged if CI passes and no conflicts

---

## 6. Testing Standards

### Test File Location
Tests live adjacent to the source file:
```
src/agents/AgentManager.ts
src/agents/AgentManager.test.ts
```

### Test Naming
```typescript
describe('AgentManager', () => {
  describe('connect', () => {
    it('should set agent status to idle on successful connection', async () => { ... });
    it('should throw AgentConnectionError if host is unreachable', async () => { ... });
  });
});
```

### Mocking
- Use Vitest's `vi.mock()` for module mocking
- Mock external CLIs (`claude`, `codex`, `gh`) using `execa` mocks
- Mock Octokit responses with typed fixtures in `tests/fixtures/`
- Never make real network calls in unit tests

### Coverage Targets
| Module | Minimum Coverage |
|--------|-----------------|
| `tasks/` | 80% |
| `agents/` | 75% |
| `github/` | 75% |
| `git/` | 70% |
| `bridge/` | 70% |
| `ui/` | 40% (TUI is harder to test) |

---

## 7. Logging

- **Never use `console.log`** in source files. Use the shared `logger` from `src/utils/logger.ts`
- Logger writes to `.nexus/nexus.log` only — never to stdout (which would break the TUI)
- Log levels: `trace`, `debug`, `info`, `warn`, `error`
- Use structured logging — pass objects, not string interpolation:

```typescript
// ❌ Bad
logger.info(`Agent ${agentId} connected to ${host}:${port}`);

// ✅ Good
logger.info({ agentId, host, port }, 'Agent connected');
```

- Never log secrets, tokens, or passwords. The log sanitizer catches known patterns, but don't rely on it.

---

## 8. React / Ink (TUI) Components

- Functional components only — no class components
- Use hooks for all state (`useState`, `useEffect`, `useReducer`)
- Keep components focused: one panel = one file
- Panels should read from Zustand store, not accept large prop trees
- Terminal colors must use the project palette (see below):

### Color Palette
| Role | Color | Ink prop |
|------|-------|----------|
| Primary accent | Cyan | `color="cyan"` |
| Success | Green | `color="green"` |
| Warning | Yellow | `color="yellow"` |
| Error | Red | `color="red"` |
| Muted / inactive | `#555` | `color="#555555"` |
| Agent: working | Cyan bold | `color="cyan" bold` |
| Agent: error | Red | `color="red"` |
| Task: review | Magenta | `color="magenta"` |

---

## 9. Security

- Never hardcode secrets, tokens, or credentials in source code
- All secrets come from environment variables only (`.env`, never `.env.committed`)
- `.env` is in `.gitignore` — verify this on every project
- Validate all external input (config files, bridge messages, API responses) with Zod before use
- Bridge auth: always reject and close connections that fail the shared-secret check within 5 seconds
- Sanitize log output: redact values matching `/gh[pousr]_[A-Za-z0-9_]+/` and similar token patterns

---

## 10. Documentation

- Every exported class, function, and interface must have a JSDoc comment
- JSDoc must include: description, `@param`, `@returns`, `@throws` where applicable

```typescript
/**
 * Dispatches a task to the specified agent and enforces the PR workflow.
 * Creates a branch, sends the task, and opens a PR on completion.
 *
 * @param agentId - The ID of the registered agent to dispatch to
 * @param task - The task to dispatch
 * @throws {AgentNotFoundError} If the agentId is not registered
 * @throws {AgentBusyError} If the agent already has an active task
 */
async function dispatch(agentId: string, task: Task): Promise<void> { ... }
```

- `README.md` must be kept up to date with any new configuration options
- Non-obvious logic must have inline comments explaining the *why*, not the *what*

---

## 11. Linting & Formatting

All code must pass:
```bash
npm run lint       # ESLint with zero errors
npm run typecheck  # tsc --noEmit with zero errors
npm run format     # Prettier (auto-formats, check in CI)
```

### ESLint Rules (key highlights)
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/explicit-function-return-type`: warn (required on public methods)
- `@typescript-eslint/no-unused-vars`: error
- `no-console`: error
- `prefer-const`: error

### Prettier Config
```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "semi": true,
  "tabWidth": 2
}
```
