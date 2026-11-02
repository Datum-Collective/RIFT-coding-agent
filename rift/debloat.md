# Debloat

RIFT is a terminal program, so `rift/sync.sh` removes what the terminal binary does not build or ship, right after
extracting an upstream release (`rift/prune.txt`, one path per line). `rift/check.sh` builds and tests the result, so
a wrong entry fails the gate. To keep something, delete its line.

Measured on v2.2.5, darwin-arm64, 2026-11-02.

| | upstream v2.2.5 | RIFT |
|---|---|---|
| workspace packages | 36 | 24 |
| `node_modules` after `bun install` | 2.6 GB | 1.1 GB |
| binary | 202 MB | 146 MB |
| `--version` start (warm) | 0.18 to 0.28 s | 0.20 s |
| peak memory, `--version` | 84 MB | 85 MB |

- Pruned packages: `app` (219K lines), `gui-plugins`, `session-ui`, `desktop`, `console`, `stats`, `web`, `stories`,
  `posts`, `function`, `sdk`, `patchmark`, `plugins`, plus infra, services, nix, specs, CI config and translated READMEs.
  The terminal binary never contained them, so they cost install, typecheck and review time, not binary size.
  The binary's dependency closure is 17 packages (`cli`, `tui`, `core`, `server`, `client`, `ai`, `plugin`, ...).
- Binary size: `bytecode: false` (patch 0008) removes 56 MB. Start-up is the same within noise on `--version`; a cold
  full-TUI start was not measured.
- Not removed, and why: `effect`, `@opentui/core`, the Claude Agent SDK and MCP are the largest dependencies in the
  JavaScript (about 12 MB minified in all) and RIFT uses them. The rest of the binary is the Bun runtime and native
  libraries.
- `.github/TEAM_MEMBERS` stays: the build reads it.
