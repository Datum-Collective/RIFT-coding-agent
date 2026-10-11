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

## Phase 4: prompt diet

Measured with `bun script/prompt-tokens.ts opencode/space-bunny-free` (o200k tokenizer, hermetic
home with no user skills), first request of `rift run`.

| Metric | Before | After | Target |
|---|---|---|---|
| System prompt | 2,148 tokens | 415 | |
| Tool definitions | 6,576 tokens (14 tools) | 2,550 (13 tools) | |
| **Fixed total** | **8,724** | **2,966** | < 3,000, met (hermetic) |
| Binary | 98.6 MB | 98.5 MB | |

What changed:

- One system prompt (`session/prompt/rift.txt`, 1.9 KB) replaces the ten model-specific prompts
  (7 to 15 KB each). No per-family addendum was kept: nothing here could test a prompt against each
  model family, and the behaviours that differ by family (apply_patch for GPT, edit and write for
  others) are handled by the tool layer, which is unchanged. If a family regresses, the place to add
  a short addendum is `SystemPrompt.provider`.
- Every tool description rewritten to the behaviour that matters. Parameter descriptions shortened;
  parameter names, types and required fields are unchanged (the schema wire-shape snapshots only
  differ in description strings).
- `browser_open` is folded into `browser` as the `external` action (opens the user's own browser).
  Same permission (`browser_open`), same URL rules, same spawn. One tool fewer in every request.
- Skills: the prompt lists names only, capped at 40 with an "and N more" suffix; the body loads
  through the skill tool. The built-in `customize-opencode` skill and its 4 KB body are gone.
- Plan-mode and build-switch reminders shortened; title prompt cut from 2.1 KB to 0.6 KB.
- The graph paragraph in the environment block is one sentence instead of a paragraph; the
  `graphwrite` tool description carries the rules.

Not changed:

- `invalid` tool: it is already excluded from the tool list sent to the model (it only receives
  repaired calls), so removing it saves no tokens and it stays.
- Plan enter/exit tools: gated behind `experimentalPlanMode`, not sent by default.

Caveats:

- With a real skills directory the number is higher: 40 names add roughly 200 tokens, so a user with
  50 or more skills sees about 3.2k. MCP tool schemas are on top of this and are Phase 5.
- Tokens are counted with a GPT-family tokenizer; the free models' own tokenizers will differ
  somewhat.
- Request guard snapshots are unchanged. A live `rift run` (pong, and a tool call that listed a
  directory) works against Zen with the new prompt, and the opt-in smoke test passes.
- `test/guard/prompt-budget.test.ts` fails if the system prompt or tool definitions grow past the
  budget.

Tests: `packages/opencode` 3328 pass, 13 fail: the same 12 as baseline, plus one smoke test
(`providers list`) that timed out under load in the full run and passes alone.

## Phase 5: MCP the Claude Code way

Measured with `bun script/prompt-tokens.ts --mcp` (new flag): five stdio servers from
`test/fixture/mcp-fake-server.ts` with 20, 14, 10, 8 and 6 tools (58 tools, realistic GitHub-style
schemas), o200k tokenizer, hermetic home.

| Metric | Before | After | Target |
|---|---|---|---|
| MCP tool schemas per request, 5 servers / 58 tools | 10,400 tokens (58 tools) | 328 tokens (1 tool: `mcp_search`) | names only until used, met |
| Fixed total with those 5 servers | 13,305 tokens | 3,231 | |
| Fixed total, no MCP servers | 2,901 | 2,901 (unchanged) | < 3,000 |
| MCP servers connected at startup | all, before the first request | none; first use or `/mcp` | |
| Binary | 98.5 MB | 98.5 MB (98,501,090 bytes) | |
| `--version` | 0.03 s, 34 MB | 0.04 s, 34 to 37 MB | |
| Request guard snapshots | baseline | unchanged | |

The no-MCP total reads 2,901 here and 2,966 in Phase 4. Nothing in the prompt changed between the
two runs; the 65-token gap is run-to-run variation in the environment block (date, paths).

What changed:

1. Config (`src/mcp/config.ts`). Three scopes, later wins: user `~/.rift/mcp.json`, project
   `.mcp.json` (nearest wins, walking up to the worktree root), local `mcp` in rift.json / opencode.json.
   The two JSON files use the `mcpServers` shape other MCP clients use (`command`/`args`/`env`, or
   `type: http|sse` + `url`/`headers`), so an existing `.mcp.json` works unchanged. Strings expand
   `${VAR}` and `${VAR:-default}` at load time; files keep the placeholders. `{ "enabled": false }`
   in rift.json turns off a server defined in another scope. `OPENCODE_DISABLE_PROJECT_CONFIG` also
   skips `.mcp.json`.
2. Approval. A `.mcp.json` server is `needs_approval` until the user decides. The TUI asks at startup
   (Allow once / Always allow / Deny); always and deny are remembered per project in
   `<state>/mcp-projects.json`. `rift mcp reset-project-choices` forgets them. In `rift run` an
   unapproved server is skipped, and `rift mcp list` says why.
3. CLI: `mcp add <name> -- <cmd> [args]`, `mcp add -t http <name> <url>`, `--scope local|project|user`,
   `-e KEY=val`, `-H "Name: value"`, `mcp add-json`, `get`, `list`, `remove`, `reset-project-choices`,
   `auth <name>`, `logout <name>`. The interactive wizard and `mcp debug` are gone.
4. Lazy connect. Nothing connects at startup. The first request that needs MCP starts every enabled,
   approved server and waits for them once, up to 5 s (`RIFT_MCP_STARTUP_WAIT`). A slower server
   joins later turns, and `mcp_search` waits for it. New statuses: `pending`, `connecting`,
   `needs_approval`.
5. `/mcp` panel (also `/mcps`): every server with scope, transport, status, tool count and auth
   state; Enter lists its tools (or asks for approval); space turns it on or off, remembered per
   project; ctrl+r reconnects; ctrl+o signs in. The TUI now refreshes MCP status, resources and
   MCP prompt commands on `mcp.tools.changed`. Before this, the sidebar never updated after startup.
6. Tool search (`src/mcp/search.ts`). When the allowed MCP tools would cost more than about 2,500
   tokens (`RIFT_MCP_TOOL_SEARCH=auto|always|never`), the request carries one `mcp_search` tool
   whose description lists every tool name grouped by server. A search (keywords, or
   `select:<full name>,...`) returns schemas and records the names in the tool result. Every later
   step of the session sends those tools with their full schemas, so the model calls them by name.
7. Names are `mcp__<server>__<tool>`, so permission rules can target `mcp__server__*` or one tool,
   and a fully denied server's tools drop out of the request and the search list. One tool result
   is capped at 100 KB (about 25k tokens); the rest is saved to a file with a truncation note.
   Remote servers that drop are retried after 1, 2, 4, 8 and 16 s. `tools/list_changed`, resources
   via `@server:uri` and prompts as slash commands were already in place and are unchanged.

Fixed along the way:

- `Truncate.output` kept nothing when a single line was longer than the byte budget (minified
  JSON). It now keeps the first `maxBytes` of that line. Affects every tool, not only MCP.
- SDK regeneration was broken by Phase 1 (`packages/sdk/js/script/build.ts` ran the deleted
  `generate` command). It now runs `script/openapi.ts`. The regenerated SDK also drops the
  `experimental.console` client Phase 1 removed server side. The TUI was still calling it at startup
  (a 404, swallowed), so the dead org-switch dialog and console state are removed from the TUI.

Tests added: `test/mcp/config.test.ts` (scopes, expansion, approvals, search ranking, naming,
per-server permission rules), `test/mcp/lazy.test.ts` (no start before use, approval once/deny,
slow server vs startup wait, on/off persisted), `test/cli/mcp-add.test.ts` rewritten for the new CLI,
`test/cli/mcp-tool-search.test.ts` (end to end through `rift run`: names only, search loads a
tool, the call reaches the server; a 400 KB result is capped with the note).

Verified by hand on the compiled binary: under a pty, the TUI shows the approval prompt for a
`.mcp.json` server, "Always allow" persists, and `/mcp` lists both servers with scope and tool counts.

Not verified: auto-reconnect of a dropped HTTP server (implemented, no test that drops a live
connection); OAuth sign-in from the `/mcp` panel against a real provider.

Tests: `packages/opencode` 3349 pass, 16 fail on the full run. After fixing two stubs and updating the
`mcp` help snapshot, the failures left are the 12 baseline ones (9 run-process timeouts, 3
attention sounds) plus 2 in `provider.test.ts` ("opencode loader keeps paid models ..."), which fail
the same way on the committed Phase 4 tree. All 487 tests in the touched areas (mcp, cli/mcp-*,
help, commands, session tools/prompt, guard, tool) pass. `packages/tui`: 264 pass.
