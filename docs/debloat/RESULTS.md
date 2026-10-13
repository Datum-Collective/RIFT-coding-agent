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

## Phase 7: UI redesign (same stack, new design)

The design system is written down in `docs/design/tui.md`: principles, layout, the gutter glyph
table, color tokens, type, components and motion. Codex CLI was the primary reference for the
interaction model (transcript-first single column, borderless composer with a status line,
inline pickers with a `›` cursor, numbered approvals, a `?` shortcut sheet, restraint with color).
RIFT's own parts: the glyph gutter, `$`-style shell blocks with a ruled output gutter, grouped
exploration, the structured checks block, the context rail, recent sessions on home, the task
view, and the indigo accent.

| Metric | Before | After |
|---|---|---|
| TUI source (`packages/tui/src`) | | 1,755 lines added, 2,899 removed (41 files) |
| TUI tests | 264 pass | 259 pass, 0 fail (5 banner tests removed with the banner) |
| Binary | 98.48 MB (98,484,578 bytes, Phase 5 tree) | 98.47 MB (98,468,066 bytes) |
| `--version` | 0.03 to 0.04 s, 34 MB | 0.03 to 0.04 s, 34 to 36 MB |
| Time until the composer is ready, compiled binary, pty, models fetch off | 2.59, 2.59, 2.61, 3.01 s | 2.42, 2.47, 2.62, 2.73 s |

What changed, by surface:

- **Theme**: a new default `rift` theme (`theme/assets/rift.json`) on the terminal's own
  background: neutrals, one indigo accent (`#7C83FF` dark / `#3D46F2` light), status colors
  only for status, tinted diffs. Users who picked a theme keep it; the old themes are still listed.
- **Transcript**: user turns as `❯ text`; reasoning as one muted `∴ thought 1.2s` line; one line
  per tool call with a gutter glyph and a bold verb; consecutive read/search/find/list calls fold
  into one `Explored` entry; shell calls as `$ command` with elapsed time, non-zero exit codes, and
  output under a faint rule collapsed to 6 lines; file changes as `± path +n −n` with a diff that
  collapses past 24 rows; plans as `≡ Plan 2/3`; subagents as `⇢`; errors as `✕`; a faint turn
  footer (`─ 1.6s · model`). A tool waiting for approval shows an amber `?` instead of a spinner.
- **Checks**: RIFT's verification report is rendered from its structured metadata as a checks
  block (one row per command with its real outcome, browser check, summary-vs-diff), with the
  prose and failing output one click away. Before, it was rendered as plain answer text.
- **Composer**: no rounded frame. A faint rule, the `❯` prompt (`$` in shell mode), and one status
  line: agent and model on the left; directory, context, cost and `? keys` on the right. While the
  agent works, an activity line above the rule shows a spinner, elapsed time, the rate-limit retry
  countdown and attempt (amber, not red), and `esc to stop`.
- **Home**: the banner art, tips carousel and home footer are gone. Home is an empty session: the
  intro line, the five most recent sessions (click to reopen), and the composer in the same place
  it sits in every session.
- **Sheets**: every dialog and picker opens docked at the bottom over the composer, full width on a
  solid surface under a faint rule; no dimmed backdrop. Selection is an accent `›` and bold text,
  not a filled bar; categories are lowercase muted labels; filter input is a `❯` line.
- **Approvals**: numbered choices (`1. Yes`, `2. Yes, and don't ask again`, `3. No, tell RIFT what to
  do instead (esc)`), keys 1 to 3 choose directly, up/down and enter still work. The question
  prompt and the reject prompt follow the same pattern.
- **Autocomplete** (`/`, `@`): same list style, descriptions aligned in one column.
- **Shortcut sheet**: `?` on an empty composer (also `/help`, `/keys`): three columns built from
  the live keymap, so rebound keys show correctly.
- **Context rail**: 36 columns, no painted panel, a faint left rule; docks at 140+ columns and
  overlays below that. Lowercase labels (`plan 2/3`, `graph 3/4`, `lsp off`), compact tree
  connectors, and a footer that no longer repeats the path and token count the composer shows.
- **Task view** (`ctrl+l`): same content; section headings are lowercase with a rule that can no
  longer wrap (the old `EXECUTIO` / `N` split at narrow widths is fixed).
- **Toasts, status strip, subagent footer, revert notice, confirm dialogs**: restyled to the same
  glyph and color rules; the status strip no longer prints internal state names.
- Removed decorative code: `banner.ts` and its README SVG generator, `bg-pulse` (background
  animation in the retry dialog), the tips carousel and home footer plugins.

Decision to note: new sessions open on the transcript, not the task view. The Phase 7 plan said
task view first; the redesign brief made the transcript the product, and the task view's essentials
now live in the rail. `ctrl+l` still toggles, and the last choice is remembered per user, so
anyone who chose the task view keeps it. Flipping the default back is one line
(`view_mode` in `routes/session/index.tsx`).

Not done from the original Phase 7 list: automatic fallback to another free model on rate limits.
That is engine behaviour, not UI; the activity line shows the countdown and attempt.

The startup row waits for the composer placeholder on the rendered screen, a stricter mark than
Phase 2's "first 3 KB of output", so it is not comparable with that number; both binaries were
built from the same tree with and without the Phase 7 changes and measured the same way.

Verified: typecheck clean for `tui` and `opencode`; `packages/tui` 259 pass; full `packages/opencode`
suite 3351 pass, 14 fail, the same 14 that fail without these changes (9 run-process timeouts,
3 attention sounds, 2 provider-loader tests). Rendered under a pty with a scripted model (home, a full
session with read/search/shell/edit/plan/checks, mid-stream, a 429 retry, the approval sheet, the
command palette, the model picker, `/` autocomplete, the shortcut sheet, the task view, the rail
docked at 150 columns and overlaid at 100, 80 columns, light mode).

Not verified: real terminal emulators and fonts (only the pty emulator was used). Each glyph was
checked for alignment there; `☰` measured two columns in the renderer and one in the terminal, so the
plan glyph is `≡` instead. A font that draws `◆ ∴ ± ⇢` wide would shift those rows by a column.
Windows was not tested.

### Phase 7, revision 2: Claude's polish, OpenCode's depth

Direction changed on review: more polish and visual richness, the RIFT opening screen back, a
better side panel, and OpenCode's depth kept. `docs/design/tui.md` is updated to match.

- **Theme**: warm neutral canvas (`#1A1917` dark / `#FAF9F5` light) with a panel tone one step up,
  the logo's azure as the accent, warmer status colours. The background is painted again.
- **Opening screen**: the block-art RIFT logo is back (with its compact fallback below 76
  columns), a tagline under it, the composer at the logo's width, a welcome card with recent
  sessions and the keys worth knowing (shown on terminals 44+ rows tall), the tips line, and the
  home footer (directory, MCP, version). Restored from the previous commit: `banner.ts`, the banner
  component and test, the banner SVG script, the tips plugin and the home footer.
- **Transcript**: a rounded intro card at the top, user turns on a panel band, tool bodies (shell
  output, diffs, plans, written files) in soft panel cards under their header line.
- **Composer**: a rounded card, accent frame while working; the hint line shows directory, MCP
  status, pending approvals, context, cost and keys.
- **Side panel**: 42 columns on the panel tone with real hierarchy: title over a rule; status;
  Context with a usage bar, tokens and cost (back from OpenCode); Plan with a progress bar; Changes
  with totals; Checks with a pass count; Graph; MCP; LSP; RIFT and version at the foot. Docks at
  130+ columns.
- **Dialogs**: floating rounded cards over a dimmed backdrop; the selected row gets a soft fill.
- **Approvals, questions, rejections, toasts**: rounded cards framed in their status colour.
- Section labels in the task view, panel and pickers are title case and bold.

Tests: `packages/tui` 264 pass, 0 fail.

### Phase 7, revision 3: blacked out

The warm canvas is replaced with true black (`#000000`) and neutral greys: panels `#0C0C0C`,
hover/selection `#181818`, frames `#262626`, faint ink `#4D4D4D`, text `#EDEDED`, muted `#8F8F8F`.
Accent stays the logo's azure. Diff tints darkened to sit on black. Light variant is plain white
and greys. Layout unchanged. `packages/tui` tests pass.

## Speed pass: provider loading on the startup path

Measured on the compiled binary, headless server, fresh instance, full models.dev catalogue
(226 providers, ~8.5k models), two runs each.

| Request | Before | After |
|---|---|---|
| `/config/providers` (TUI waits on this) | 207, 210 ms | 85, 90 ms |
| `/provider`, first | 283, 292 ms | 301, 305 ms |
| `/provider`, repeat | 285, 287 ms | 137, 150 ms |

End to end (compiled binary, pty, time until the composer is ready, full catalogue): 2.42 to
2.44 s before, 1.95 to 1.97 s after (warm runs; first runs 2.44 s and 2.08 s).

- The model validator is built once instead of on every call (`toPublicInfo`).
- The provider state copies a catalogue entry only when that provider is touched, instead of
  deep-cloning all 226 up front.
- Public provider copies are cached per source object for responses.
- The TUI no longer waits for the full provider catalogue (several MB, used only by the connect
  dialog) before first paint; it loads in the background.

Request guard snapshots unchanged; provider/guard/server tests 959 pass (the 2 failures are the
pre-existing "opencode loader keeps paid models" tests); `packages/tui` passes.

## Phase 6: shrink `rift run`

`rift run` was already a plain streaming printer in `run.ts`; the 18.5k lines in `src/cli/cmd/run/`
were a second interactive interface (`rift --mini`, split-footer mode, demo commands, replay)
duplicating the TUI. Removed it and kept the printer.

| Metric | Before | After |
|---|---|---|
| `src/cli/cmd/run/` | 18,531 lines (36 files) | gone; `run-print.ts` 120 lines |
| Shipped source in `packages/opencode/src` | | 144 lines added, 18,851 removed |
| Tests | | 9,800 lines of tests for the removed mode deleted |
| Binary | 98.52 MB | 98.25 MB (98,253,410 bytes) |
| `rift run` with a 5-step scripted model, compiled | 2.65 to 3.18 s | 2.67 to 2.74 s |
| Full `packages/opencode` suite | 12 to 14 failures | 5 failures |

- Removed: `rift --mini` and its flags (`--replay`, `--no-replay`, `--replay-limit`, `--demo`), and
  `rift run --interactive`/`--mini`/`--replay`/`--replay-limit`/`--demo`.
- Kept: `--model`, `--agent`, `--variant`, permission flags (`--auto`, `--yolo`,
  `--dangerously-skip-permissions`), `--format json`, `--command`, `--continue`/`--session`/`--fork`,
  `--attach`, `--file`, `--share`, `--title`, `--thinking`, piped stdin.
- Output contract unchanged: the reply on stdout, one line (or a short block for shell output and
  plans) per tool call on stderr, exit code non-zero on error.
- The 9 `run-process` tests that timed out on every run since the baseline now pass. The remaining
  5 failures (2 provider-loader, 3 attention-sound) fail the same way on the untouched baseline.

### Fewer git processes at startup

Repository discovery asked `git rev-parse` three times (`--show-toplevel`, `--git-dir`,
`--git-common-dir`); it now asks once with all three flags and falls back to the three separate
calls if that fails (outside a work tree), so results are identical. Startup ran this discovery
about five times from different services.

| Metric | Before | After |
|---|---|---|
| git processes during TUI startup | 22 | 12 |
| Time until the composer is ready, compiled, full catalogue (same session, back to back) | 3.03 to 3.11 s | 2.96 to 3.00 s |

The machine was under more load than in the earlier speed pass, so both columns are slower than
the 1.97 s measured there; the comparison is between builds measured together.

Tried and reverted: a 10-second memo of discovery and `remote get-url`. It hid a remote added (or a
`git init`) mid-session for up to 10 seconds, which three project tests caught.

## Remotion: /video rebuilt on Remotion's official skills

`/video` used a custom "rift-video" Remotion engine (typed specs, scene catalog, validate/frames
scripts) embedded in the binary as an 894 KB file and written into projects by `rift video init`.
It is replaced by Remotion's official Agent Skills (remotion-dev/skills, the skills in Remotion's
Claude Code plugin).

| Metric | Before | After |
|---|---|---|
| Binary | 98.25 MB | 97.30 MB (97,295,714 bytes) |
| Video code in the repo | `video/` engine (110 files, 1 MB) + embedded template + scaffold | a 45-line workflow prompt and a 75-line CLI |

- `/remotion <brief>` (and `/video`, same workflow): loads `remotion-best-practices` and the skills
  it routes to; storyboard first; build; render a still from every scene and read it before the
  final render; confirm the MP4's resolution, fps and length; report.
- `rift remotion setup [-g]` runs `npx skills add remotion-dev/skills -a claude-code -s '*' -y`
  (tested: installs all 12 skills into `.claude/skills` without prompts). `rift remotion new
  <name>` runs `npx create-video@latest --yes --blank --no-tailwind` and `npm install`.
  `rift remotion studio` opens Remotion Studio. `rift video` is an alias.
- RIFT now loads skills from installed Claude Code plugins (`~/.claude/plugins/installed_plugins.json`),
  honouring each plugin's `plugin.json` skill list, so `claude plugin install remotion@remotion`
  makes the skills available in RIFT too. Verified against this machine: the 12 Remotion skills
  and the installed mattpocock-skills plugin's skills appear in RIFT's command list; the plugin's
  unlisted (deprecated) skills do not. A manifest entry that points outside its plugin is ignored.
- Removed: the repo's `video/` engine, `src/video/` (scaffold and the 894 KB template),
  `script/video-template.ts` and its build step, `rift video init`, and the repo's
  `.claude/commands/video.md`. README section rewritten.

### Test suite reliability

The `run-process` tests spawn a full CLI each, and `bun test` ran up to 20 of them at once; on a
busy machine they timed out (the "9 run-process timeouts" listed since the baseline). Reverting the
latest changes did not help; capping concurrency did (`--max-concurrency=2`: 13 of 13 pass). The
package test script now passes `--max-concurrency=4`. Full suite with the cap: 3170 pass, 6 fail;
5 are the pre-existing failures (2 provider-loader, 3 attention-sound) and the sixth, a PTY test
that waits on a 5-second shell, passes on its own under the script's 30 s timeout.

## Simpler home, lighter boot

- Home is the logo, the tagline, the composer with its one status line, and a single one-line tip.
  The recent-sessions and keys columns are gone (`ctrl+x l` and `?` cover them); tips longer than
  one line are skipped and a command with several bindings shows only the first; the footer is a
  single line.
- Modules that only some actions need now load on first use instead of at boot: npm's config reader
  (`@npmcli/config` and the glob/workspace code under it; used by upgrades and plugin installs),
  npm's package-spec parser, and the HTML-to-Markdown converter used by web fetch (`turndown` and
  its DOM). In a CPU profile of importing the engine runtime these accounted for roughly 90 ms of
  module evaluation.
- `script/bundle-report.ts --why <package>` prints the import chain that pulls a package into the
  bundle.

Not measured end to end: the machine's load average was 8 to 16 during this pass and repeated
timings of the same build varied by more than the expected gain.

Found and left alone: the AWS event-stream code comes from the Bedrock protocol in the `llm` package
(frozen); `fast-check` is pulled in by Effect's barrel export; `zod/v3` by the MCP SDK.
