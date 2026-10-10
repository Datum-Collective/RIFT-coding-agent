# Debloat results

One section per phase. Numbers are measured with the commands in `baseline.md`.

## Phase 0: baseline and guards

No behaviour change. Added the request guard tests, the opt-in network smoke test, the prompt-token
script and the bundle report. Baseline numbers are in `baseline.md`.

| Metric | Value |
|---|---|
| Binary | 146.1 MB |
| `--version` | 0.46 s, 197 MB RSS |
| Fixed prompt tokens | 8,724 (14 tools) |

## Phase 1: remove what is not the terminal product

| Metric | Before | After |
|---|---|---|
| Binary | 146.1 MB | 105.5 MB (105,469,154 bytes) |
| `--version` | 0.46 s, 197 MB | 0.42 s, 172 MB (lazy startup is Phase 2) |
| `rift run "reply with pong"` | 4.1 s | 3.9 s |
| Shipped TS/TSX, no tests | ~474k lines | ~173k lines |
| Fixed prompt tokens | 8,724 | 8,724 (unchanged, as expected) |
| Request guard snapshots | baseline | unchanged |

Deleted:

- Packages: app, ui, session-ui, console, stats, desktop, web (docs), storybook, slack,
  containers, function, identity, sdk-next, client, cli, httpapi-codegen.
- Repo clutter: Desktop, github (GitHub Action), infra, nix, flake, sdks/vscode, sst config,
  STATS.md, 21 translated READMEs, opencode/.github (inert, GitHub reads only the root one),
  upstream-only scripts (translate-app, stats, duplicate-pr, beta, raw-changelog, github/*).
- Web UI: `createEmbeddedWebUIBundle` and the `opencode-web-ui.gen.ts` entry in `build.ts`, the
  `web` command, the catch-all UI route that proxied app.opencode.ai, `OPENCODE_DISABLE_EMBEDDED_WEB_UI`.
- Commands: acp (and src/acp), github (+ handler, shared), stats, db, plug, account/console,
  generate, attach, web. `debug` is cut down to `debug info` and `debug paths`.
- Account: src/account, remote console config loading in `config.ts`, the `/experimental/console*`
  routes.
- Tests whose subject was removed (acp, github action, account, attach, plug install, web UI).

Moved: the six attention sounds from packages/ui to packages/tui/audio (the TUI imported them).

Kept, and why:

- `serve`: the test harness boots it for the `run` process tests and it is 24 lines. The TUI itself
  runs on its in-process server, which was verified (renders and accepts input under a pty).
- `agent`: not on the remove list.
- `control-plane` (workspaces, 1.3k lines): `WorkspaceContext` is threaded through instance-state,
  the bridge, run-service and the session projector, and the workspace table is part of the
  database schema. Removing it needs a migration decision, so it is skipped, not forgotten.
- OpenCode share (`share-next.ts`, `session.ts`): the feature inventory lists them as part of
  RIFT's share orchestration, so they stay.
- `debug info`: the inventory lists `rift debug info` under version reporting.
- GitHub Action guard (`shouldShareSession`): it only existed for the removed `github` command, so
  there is nothing left to guard. Noted for review.

Test results (full `packages/opencode` suite): 3464 pass, 20 fail on the first run. After fixing the
fallout, the failures left are the ones already failing on the untouched baseline: 9 in
`test/cli/run/run-process.test.ts` and 3 in `attention.test.ts`. `packages/tui`: 264 pass.
Test harness change: child processes now get `--preload @opentui/solid/preload`, because the
removed React-based packages had been satisfying a JSX runtime fallback by accident.
