# Changelog

All notable changes to NEXUS are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Initial project structure and scaffold
- TypeScript 5 + Ink v4 TUI framework setup
- Git integration via simple-git (branch, status, diff, log)
- GitHub integration via Octokit (issues, PRs, collaborators)
- Claude Code local agent adapter
- OpenCodex local agent adapter
- Remote agent bridge (WebSocket + SSH tunnel) for OpenClaw
- Task assignment engine with auto-routing rules
- PR enforcement wrapper — all agent commits go through PRs
- Sub-repository detection and context switching
- Human contributor panel with GitHub collaborator sync
- Keyboard-driven command interface
- Structured file logging via pino (no stdout pollution)
- Zod-based config validation with helpful error messages
- Reconnect logic with exponential backoff for remote agents

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | TBD | Initial public release |
