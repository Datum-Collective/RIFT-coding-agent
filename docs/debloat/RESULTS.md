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

## Phase 2: lazy startup

| Metric | Before (Phase 1) | After | Target |
|---|---|---|---|
| `--version` wall time | 0.42 s | 0.03 s (0.03 to 0.04) | < 0.1 s, met |
| `--version` max RSS | 172 MB | 34.7 MB | < 60 MB, met |
| TUI first paint (pty, >3 KB of output) | 1.10 to 1.20 s | 1.08 to 1.18 s | < 0.3 s, **not met** |
| `rift run "reply with pong"` | 3.9 s | 3.9 s | n/a |
| Binary | 105.5 MB | 105.5 MB | |

What changed:

- `src/cli/commands.ts` is a table of command name, aliases, description and a loader.
  `src/index.ts` imports only the selected command; the others are registered as description-only
  stubs so `--help` is unchanged (help snapshots pass). `commands.test.ts` checks every stub
  against the real module so the two cannot drift.
- `--version` and `-v` print the release without loading yargs commands, Effect or the engine.
- TUI: the worker is started before the TUI modules are imported, so the engine boots while the
  main thread loads the UI; `AppNodeBuilder` (which imports every engine service) is no longer
  pulled in for `TuiConfig` and the TUI layer.

What was tried and rejected:

- `bytecode: true` in the Bun compile: first paint 0.80 s, but the binary grows from 105 MB to
  280 MB. It works against the size target, so it was reverted.

Why first paint stays near 1 s: a trace of the compiled binary shows 0.21 s before the command
handler runs, about 0.5 s loading the config, plugin and TUI module graph (including the OpenTUI
native library load), and about 0.3 s for the first render and data sync. The remaining cost is
module evaluation of the TUI and its dependencies, which only shrinks with fewer or lazier modules
(Phase 3 removes dependencies) or bytecode. Not claimed as met.

Not done: lazy loading of LSP, MCP, share, video and browser inside the engine. They are already
initialised lazily by their own services ("all LSPs are disabled" appears at bootstrap, share and
video do nothing until used); I did not find a measurable cost to remove in the `rift run` trace,
so I left the engine bootstrap alone rather than change behaviour for no measured gain.

## Phase 3: trim providers and dependencies

| Metric | Before (Phase 2) | After |
|---|---|---|
| Binary | 105.5 MB | 98.6 MB (98,616,674 bytes) |
| JS bundled from inputs (`bundle-report`) | 28.0 MB at baseline, ~23 MB after Phase 1 | 17.1 MB |
| `--version` | 0.03 s, 34.7 MB | 0.03 s, 34 MB |
| Shipped TS/TSX, no tests | ~173k lines | ~162k lines |
| Fixed prompt tokens | 8,724 | 8,724 (prompt work is Phase 4) |
| Request guard snapshots | baseline | unchanged (4 snapshots, 5 tests pass) |

Removed:

- Provider plugins in `core/src/plugin/provider`: alibaba, amazon-bedrock, azure (+ cognitive
  services), cerebras, cloudflare-ai-gateway, cloudflare-workers-ai, cohere, deepinfra, gateway,
  gitlab, google-vertex (+ anthropic), kilo, llmgateway, nvidia, perplexity, sap-ai-core,
  snowflake-cortex, togetherai, venice, vercel, xai, zenmux.
- Auth plugins in `opencode/src/plugin`: azure, cerebras, cloudflare, digitalocean,
  snowflake-cortex, xai, modal, and the gitlab and poe auth packages.
- Custom loaders and bundled-SDK entries for those providers in `provider/provider.ts`, the
  GitLab workflow model handling in `session/llm.ts`.
- OpenTelemetry: tracer wiring in `session/llm.ts` and `agent/agent.ts`, the trace exporter in
  `core/src/observability/otlp.ts`, and the `@opentelemetry/*` and `@effect/opentelemetry`
  packages. The `experimental.openTelemetry` config key is still accepted and now does nothing.
  OTLP log export (Effect's own logger) is unchanged.
- The `codemode` package, the `execute` tool and `OPENCODE_EXPERIMENTAL_CODE_MODE`.
- Dependencies: 22 `@ai-sdk/*` and provider SDK packages, AWS credential providers, GitLab auth,
  google-auth-library, ai-gateway-provider, venice, octokit (3), the ACP SDK. Lockfile shrank by
  about 6k lines across Phases 1 and 3.
- Patches for packages that are gone (xai, gcp-metadata, dnd-kit, pierre trees, tanstack virtual).

Kept, and why:

- `@ai-sdk/mistral`: one Zen model (`opencode/mistral-large-4`) declares it as its transport, so
  removing it would change a Zen request. The transport rule is frozen.
- `@ai-sdk/google`: used by Zen's Gemini models as well as the google provider.
- `llm` package (including its bedrock/azure/cloudflare protocol files): frozen by the plan.
- `bonjour-service`: still used by `--mdns` server discovery in `src/server/mdns.ts`.
- `@ai-sdk/amazon-bedrock` and `@ai-sdk/google-vertex` as **dev** dependencies only: the
  `transform.test.ts` suite exercises their wire format. Nothing in `src` imports them and they
  are not in the binary.
- `models.dev` embedded snapshot (4.8 MB of the bundle): part of the frozen models path.
- `core` provider-option schema keys for removed providers: they are config compatibility, not code.

Behaviour change to be aware of: providers that were bundled are no longer. A user who configures,
for example, `xai` or `azure` still gets the dynamic path (the package is installed from npm on first
use through the dynamic provider plugin), but the special-cased login flows and header tweaks for
those providers are gone.

Tests: `packages/opencode` 3333 pass, 12 fail (the same 12 that fail on the untouched baseline:
9 run-process timeouts and 3 attention-sound tests). `packages/core` 957 pass, `packages/llm` 298
pass. Tests for removed providers were deleted with them.
