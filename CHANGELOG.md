# Changelog

All notable changes to NEXUS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Initial TypeScript + Ink (React) TUI scaffold
- Basic panel layout: Agents, Tasks, Git status, Logs
- Config loader + schema validation for `nexus.config.json`
- Git service (status, file lists, ahead/behind, best-effort sub-repo detection)
- GitHub service (Octokit) and Tasks panel support via `GITHUB_*` env vars
- Local agent session scaffolding for `claude` and `codex` CLIs
- Vitest test scaffolding for core services

> Note: items like remote agent bridges, intelligent task assignment, and PR enforcement are part of the roadmap but are **not** shipped end-to-end yet.

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | TBD | Initial scaffold release |
