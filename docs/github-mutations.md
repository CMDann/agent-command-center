# GitHub mutation boundary

NEXUS separates GitHub reads from writes on purpose.

## Read path

Use `src/github/GitHubService.ts` for:
- listing issues
- listing pull requests
- reading PR/check status

This path is intended to be safe for dashboard refresh, sync loops, and read-only task state hydration.

## Write path

Use `src/github/GitHubWriteService.ts` for:
- creating issues
- creating pull requests
- adding issue / PR comments

This path is higher risk because it mutates external state.

## Operator policy

NEXUS should only mutate GitHub when the action is explicit in product flow:
- human-triggered issue creation from the UI
- agent PR wrapping where `autopr: true`
- issue comments that are directly tied to automation status

NEXUS should not perform speculative or background GitHub mutations from read/sync loops.

## Failure handling expectations

Every GitHub mutation should:
- fail closed on missing credentials
- surface permission/API failures clearly
- keep mutation logic separate from read-only services
- have focused tests for permission/failure paths

## Credentials

Write operations require:
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

Prefer a fine-grained token with only the scopes needed for issues and pull requests.
