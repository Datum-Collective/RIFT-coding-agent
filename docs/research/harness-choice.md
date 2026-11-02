# Research: which open-source harness should RIFT be rebuilt on

Written 2026-11-02. Evidence marks: **READ** = I read the source file or doc text in a local clone under `/Users/shiv/Developer/rift-sync/ref/` (or the field output of `gh api` for repo metadata). **SUMMARY/SNIPPET** = secondhand. **NOT MEASURED** = I did not run it. No web pages were used as evidence; every claim below is from clones or the GitHub API. Line counts are `wc -l` over the file types named, so they include comments and blanks.

Clones used (all `--depth 1`): `ref/pi-mono` (now served as `earendil-works/pi`), `ref/codex`, `ref/gemini-cli`, `ref/mini-swe-agent`, `ref/goose`, `ref/crush`, `ref/aider`. Note: one stray `git log -1` ran against the existing `ref/codex` clone (read-only, no state change); nothing else touched existing repos.

## 1. Comparison table

| | **Pi** | Codex | Gemini CLI | mini-SWE-agent | Goose | Crush | Aider |
|---|---|---|---|---|---|---|---|
| Licence (READ LICENSE) | MIT, (c) 2025 Mario Zechner | Apache-2.0 + NOTICE (Ratatui-derived code, MIT) | Apache-2.0 | MIT | Apache-2.0 (API field) | **FSL-1.1-MIT**: no "Competing Use" for 2 yrs per version, then MIT | Apache-2.0 |
| Relabel as RIFT? | Yes; keep MIT notice | Yes; keep LICENSE+NOTICE, no OpenAI trademarks | Yes; keep LICENSE, state changes | Yes; keep notice | Yes | **Risky**: RIFT is a competing coding agent | Yes |
| Language | TypeScript (Node >= 22.19; `bun build --compile` script exists) | Rust | TypeScript (Ink/React) | Python | Rust | Go | Python |
| Total size | 228K lines TS in `packages/*/src` | **2.22M** lines Rust (incl. inline tests) | ~275K lines TS, tests excluded (cli 127K + core 141K + small pkgs) | 5.3K lines Python | 304K lines Rust (crates/) | 117K lines Go, tests excluded | 20K lines Python (aider/, excl. tests) |
| Core loop size | `agent/src` 2.6K; `agent-loop.ts` 959 | `core` 489K, `tui` 480K | `core/src/core` + `scheduler` (not counted separately) | `agents/default.py` 190 | not measured | `internal/agent` (not counted separately) | n/a |
| Extension points | Extensions with ~40 events, tools, commands, providers, UI; skills; prompt templates; themes; packages; MCP; RPC; SDK | Hooks (PreToolUse, PostToolUse, PermissionRequest, Stop, ...), MCP, skills, plugins, app-server | Hooks, extensions, MCP, skills, subagents/A2A, policy engine | Subclass agent/model/env classes; YAML templates | MCP-centric extensions, ACP | Hooks, skills, MCP, LSP | Few; mostly flags |
| Provider layer | 4 wire APIs (OpenAI completions/responses, Anthropic messages, Google) + Bedrock/Vertex/Azure; custom base URL; dynamic `refreshModels`; **built-in OpenCode Zen provider generated from models.dev** | **Responses API only** (`wire_api = "chat"` is a hard error) | Gemini-only `ContentGenerator` (AuthType enum: OAuth, API key, Vertex, ADC, gateway); no chat-completions path found | LiteLLM / OpenRouter / Portkey / Requesty models | many providers | many, via Charm catwalk | LiteLLM |
| TUI | Own differential TUI (`pi-tui`, 20K lines), themes (JSON), custom header/footer/editor/overlays | Ratatui, 480K lines, Rust only | Ink (forked `@jrichman/ink`) + React | None to speak of (prompt loop, optional Textual inspector) | CLI + Electron desktop | Bubble Tea | Plain terminal |
| Compaction | LLM summary at threshold, branch summaries, hooks to replace it | yes (`hooks/events/compact.rs`) | yes (services) | **none** | `goose-context-management` crate | yes | repo-map based |
| Permissions / sandbox | **None built in by design** (docs/security.md); `tool_call` hook can block; container docs | seatbelt/bwrap/Windows sandboxes, execpolicy | seatbelt, bwrap, Windows sandbox, policy engine TOML | confirm / yolo / human modes only | permission modes | permission service | none |
| Maintenance (gh api, 2026-11-02) | pushed today; **636 commits in last 30d**; ~310 contributors; 119K stars; 316 open issues | 1,162 commits/30d; ~700 contributors | 107 commits/30d; ~703 contributors | **0 commits/30d** (last push 2026-10-26); 39 contributors | 143 commits/30d | 158 commits/30d | **0 commits/30d** (last push 2026-05-22) |
| Light? | Medium-light; core is small, product around it is large | No | No (heavier than target) | Yes, but too bare | No | Medium | Light but stale |

OpenCode itself, for scale: `rift-v2/opencode/packages` has about 811K lines of `.ts` (all packages, my count) against the 578K cited in the brief (different scope). Either way Pi's whole workspace is under a third of it, and Pi's agent+ai+coding-agent+tui is ~128K lines.

## 2. Recommendation

**Build RIFT on Pi (`earendil-works/pi`, formerly `badlogic/pi-mono`), pinned to a release tag, extending it through its extension API rather than patching core.**

Why, from the source:

1. **The connection layer is already there.** `packages/ai/src/providers/opencode.ts` (28 lines, READ) is an "OpenCode Zen" provider exposing four wire APIs (Anthropic messages, Google, OpenAI completions, OpenAI responses) and adding the `x-opencode-session` header OpenCode needs (`opencode-headers.ts`, READ). Its model list is generated from the models.dev v2 API (`packages/ai/catalog/README.md` and `catalog/providers/opencode.ts` choose the endpoint per model from the protocols models.dev lists, READ). RIFT does not have to port OpenCode's provider code; it only needs the free-tier shim (section 4).
2. **Extension surface matches RIFT's feature list.** `packages/coding-agent/docs/extensions.md` (READ) documents `pi.on(...)` events including `before_agent_start`, `agent_before_settle`, `agent_end`, `tool_call` (can block), `tool_result` (can rewrite), `session_before_compact`, `context`, `before_provider_request`, `cache_warming_decision`, `model_select`, plus `registerTool`, `registerCommand`, `registerShortcut`, `registerProvider`, `ctx.ui.custom/setFooter/setWidget`, `ctx.compact()`, `ctx.newSession/fork/navigateTree`, `ctx.modelRegistry.complete/streamSimple`. Shipped examples in `packages/coding-agent/examples/extensions/` include `permission-gate.ts`, `protected-paths.ts`, `plan-mode/`, `subagent/`, `git-checkpoint.ts`, `custom-compaction.ts`, `handoff.ts`, `todo.ts`.
3. **Small, readable core.** `packages/agent/src` is 2.6K lines; the loop is one 959-line file. The big files are `agent-session.ts` (4,479) and `session-manager.ts` (2,028) in coding-agent.
4. **Three run modes beyond the TUI**: print/JSON, RPC (`docs/rpc.md`) and a TypeScript SDK (`docs/sdk.md`) (listed in README, READ). This allows RIFT's current OpenTUI/Solid frontend to be kept as an RPC client if re-porting the TUI is too costly (completeness of RPC UI methods NOT verified).
5. **Same language as RIFT** (TypeScript), so the RIFT verify/graph/memory code ports without a rewrite. MIT, so relabelling is straightforward.
6. **Why not the others**: Codex is 2.2M lines and Responses-API-only (READ `model-provider-info/src/lib.rs`: `WireApi` has one variant; `"chat"` returns an error), which cuts off most Zen/models.dev models without a translating proxy. Gemini CLI is Gemini-shaped throughout (`core/src/core/contentGenerator.ts` AuthType list) and still ~275K lines with a React/Ink TUI. mini-SWE-agent has no TUI, sessions, compaction or tool permissions (190-line loop; modes human/confirm/yolo only, READ `agents/interactive.py`). Crush's FSL licence forbids competing use. Aider and mini-SWE-agent have no commits in 30 days.

### RIFT features vs Pi

| RIFT feature | Fit | Basis |
|---|---|---|
| Model/provider layer, models.dev catalog, Zen | **Free** (shim for the public key) | READ `providers/opencode.ts`, `catalog/README.md` |
| Skills, MCP, custom tools, slash commands | **Free** | `docs/skills.md`, `docs/mcp.md`, extensions.md (READ) |
| Sessions, tree/fork/clone | **Free** | `docs/sessions.md` (READ) |
| Session share | **Mostly free**: `modes/interactive/session-share.ts` and `core/export-html/` exist (file names READ; behaviour not read) | |
| Compaction + task memory that survives it | Extension: `session_before_compact` / `session_compact`, example `custom-compaction.ts`; inject memory via `context` or `before_agent_start` | READ docs |
| Verification (run tests/lint, diff vs summary) | Extension: `agent_before_settle` / `agent_end` + `tool_result`; protected files via `tool_call` block. Port of current `rift-verify` plugin. | READ event list |
| Permission modes | **Build**: Pi has none; `tool_call` hook plus `permission-gate.ts` is the base | READ `docs/security.md` |
| Planner/worker split | Extension: `model_select`, `ctx.modelRegistry.complete`, `plan-mode` example | READ |
| Engineering graph, browser tool | Extension tools or MCP server | |
| Cache-stable prompts | Better than OpenCode: `core/cache-stats.ts`, `core/cache-warmer.ts`, `cache_warming_decision` event exist (names READ) | |
| Checkpoints / rewind | Conversation: `/tree` free. Files: build on `git-checkpoint.ts` example | READ |
| Best-of-N in git worktrees | **Build**: no worktree feature; spawn child `pi` processes in `git worktree`s, following `examples/extensions/subagent` (separate `pi` process per agent, READ README) | |
| Background runs | RPC/print modes make it possible; no scheduler read | |
| Sandbox | **Build/awkward**: only `docs/containerization.md` and a `gondolin` example. Codex and Gemini CLI have real seatbelt/bwrap code RIFT could borrow ideas from. | READ |
| Koi screensaver TUI | **Awkward**: Pi's TUI is its own (`packages/tui`), not OpenTUI/Solid. Options: `ctx.ui.custom()` overlay (cf. `doom-overlay`, `snake.ts` examples), or keep OpenTUI as an RPC client. | READ |

### Top 3 risks

1. **Churn and ownership shift.** 636 commits in 30 days, version 1.4.0, repo renamed/moved (`badlogic/pi-mono` is now `earendil-works/pi`, packages published under `@earendil-works`). Tracking upstream will hurt if RIFT patches core. Mitigation: pin a tag, stay in extensions, keep core patches under a small list. Also README says new contributors' issues/PRs are auto-closed, so upstreaming fixes is slow.
2. **No safety layer, and the TUI is not OpenTUI.** Permission modes, tamper-resistant protection and sandboxing are all RIFT's to build (Pi's own doc says it does not ask before every tool call). The koi TUI must be re-implemented against `pi-tui` or run as an RPC client. Both are real work and the main schedule risk.
3. **Footprint and Node requirement on 8 GB.** Pi requires Node >= 22.19 (README, READ) or a bun-compiled binary (script in `packages/coding-agent/package.json`, READ). I did not run or measure startup time or RSS, and its `pi-ai` package carries generated model data for ~60 provider files. Measure before committing (build step 1).

### Fallback

- **First fallback (same upstream, less coupling):** use only `pi-agent-core` (2.6K lines) and `pi-ai` (28K lines, includes the Zen provider and catalog) as libraries under RIFT's existing OpenTUI/Solid frontend and RIFT's own session/permission code. Loses Pi's extension system and sessions; keeps providers and the loop.
- **If Pi churn proves unmanageable, non-Pi fallback:** Gemini CLI (Apache-2.0, hooks, policy engine, seatbelt, subagents), by writing an OpenAI/Anthropic-compatible `ContentGenerator`. Heavier and Gemini-typed internally; only a fallback.

## 3. Harness-by-harness notes (source-level)

**Pi** (READ unless noted). MIT. Packages: agent 2.6K, ai 28K, coding-agent 77K, tui 20K, mcp 3.3K, schema 4.6K, codemode 3K, telemetry 1.6K, plus chord 50K, durable 34K, env 2.4K, evals 1.4K (purpose of chord/durable not read). Tools in `core/tools/`: bash, edit, read, write, find, grep, ls. System prompt builder `core/system-prompt.ts` 228 lines. Customisation: `piConfig.configDir` in package.json (default `.pi`), themes in `modes/interactive/theme/*.json`. Skills and sub-agents: README says it skips sub-agents and plan mode by design; examples exist. Provider override of any existing provider by `pi.registerProvider("anthropic", {baseUrl, headers})` (custom-provider.md). `models.json` adds any OpenAI/Anthropic/Google-compatible endpoint with `baseUrl`, `api`, `apiKey`, `models`. Credentials order: `--api-key`, `auth.json`, `models.json`, env (models.md).

**Codex** (READ). Apache-2.0, NOTICE requires Ratatui attribution. 2.22M Rust lines in `codex-rs` (core 489K, tui 480K, app-server 210K, hooks 17K, sandboxing 12K). Strong: hooks (`hooks/src/events/pre_tool_use.rs`, `permission_request.rs`, `stop.rs`, ...), plugins (`plugin/`), skills (`skills/`), a `worktree` crate, `memories` crate, linux/windows sandboxes, execpolicy. Provider: config has `base_url`, `env_key`, `query_params`, `http_headers` but wire protocol is Responses only. TUI is Ratatui in Rust: restyle needs Rust and a build of a 2M-line workspace (Bazel and Cargo files present). Wrong size and wrong language for RIFT; best used as a design reference for sandbox and hooks.

**Gemini CLI** (READ). Apache-2.0. `packages/core` 141K, `cli` 127K (non-test). Version string `0.67.0-nightly.20261020`. Good: `core/src/hooks/` (registry, planner, runner, trust), `core/src/policy/` (TOML policy engine), `core/src/sandbox/{macos,linux,windows}`, `core/src/agents/` (local subagents, A2A, browser agent dir), `sea/` single-executable launcher, `docs/extensions`, `docs/hooks`. Provider layer is built on `@google/genai`; AuthType has no OpenAI/Anthropic entry (`contentGenerator.ts` lines 63-70). Ink TUI fork.

**mini-SWE-agent** (READ). MIT, 5,349 lines Python in `src/`. `DefaultAgent` is 190 lines; one bash tool, templates in YAML, step and cost limits, `Environment` (local/docker/singularity) and `Model` (litellm, openrouter, portkey, requesty) classes are the extension points. No compaction, sessions, TUI, or permission system beyond confirm/yolo. Right choice for benchmarking, wrong for RIFT's product. Last push 2026-10-26, 0 commits in 30 days (API).

**Goose, Crush, Aider, Cline/Roo, OpenHands** (brief; Goose/Crush/Aider code partly inspected, Cline/Roo/OpenHands only GitHub API metadata). Goose: `aaif-goose/goose`, Apache-2.0, 304K Rust lines, MCP-first, desktop app; heavy. Crush: `charmbracelet/crush`, FSL-1.1-MIT (competing use clause read at LICENSE.md lines 28-43), 117K Go lines, uses `charm.land/catwalk` for models; licence rules it out for a competing product. Aider: Apache-2.0, 20K Python lines, last push 2026-05-22, 0 commits in 30 days, built on LiteLLM; weak fit (no tool-agent architecture, stale). Cline (Apache-2.0, 71K stars) and OpenHands (MIT, 92K stars, ~580 MB repo) are large and IDE/server oriented (API metadata only); Roo-Code is **archived** (API `archived: true`). Not pursued.

## 4. Integration sketch: Pi + OpenCode connection layer + models.dev

**What Pi already does (READ):** `opencodeProvider()` registers id `opencode`, name "OpenCode Zen", auth `envApiKeyAuth(..., ["OPENCODE_API_KEY"])`, models from generated catalog, four API implementations each wrapped by `withOpenCodeSessionHeader`. Catalog generation (`npm run generate-models`) pulls models.dev v2 (`https://models.dev/experimental/v2.0/api.json`), picks per-model protocol in the order responses, messages, generate-content, chat-completions. Runtime refresh: `pi update --models` and an overlay from pi.dev (models.md). A `refreshModels` provider callback supports live lists (extensions.md line ~1964).

**What RIFT's current layer does that Pi lacks (READ in RIFT):** in `rift-v2/opencode/packages/core/src/plugin/provider/opencode.ts` (lines ~306-320) the provider falls back to apiKey `"public"` when there is no key and disables models whose cost has no input price above 0 (`core/test/plugin/provider-opencode.test.ts:1608` asserts this). Pi's `envApiKeyAuth` requires `OPENCODE_API_KEY`. Design (inferred, not yet tested): a RIFT extension calls `pi.registerProvider` with a native `Provider` wrapper around `opencodeProvider()` that (a) supplies `"public"` when no key is stored, (b) uses `filterModels` (documented, extensions.md line ~2068) to keep only zero-cost models in that case, (c) optionally sets `baseUrl`/headers if Zen's endpoint changes. Whether Zen accepts `"public"` through Pi's request path must be smoke-tested.

**First 5 build steps**
1. **Fork and measure.** Fork `earendil-works/pi` at a pinned tag. Keep `LICENSE` (MIT) and the copyright line. Set `piConfig.configDir` to `.rift`, rename the bin. Build the bun-compiled binary (`build:binary` script) on the 8 GB Mac; record cold start and RSS for the TUI and for `--mode rpc`. Go/no-go gate.
2. **Zen shim.** Write the provider-wrapper extension above; verify `pi --list-models` shows the free Zen models without a key, one tool-calling turn works on a free model, and a paid model is hidden. Add a startup `pi update --models` equivalent so the models.dev catalog stays fresh.
3. **Port verify.** Move `rift-verify` to an extension: run project test/typecheck/lint in `agent_before_settle`, return real output, compare the agent's final summary to `git diff`; block edits to protected paths in `tool_call` and mark unrunnable checks "not verified". This is the product's core promise, so it must work before the UI work.
4. **Memory, graph, permissions, planner/worker.** Task memory via `session_before_compact` and `context`; engineering graph and browser as tools (or MCP); permission modes as a `tool_call` gate on top of `permission-gate.ts`; planner/worker through `model_select` and `ctx.modelRegistry.complete`.
5. **TUI decision spike, then v2 features.** Two-day spike: koi screensaver as a `ctx.ui.custom` overlay/footer on `pi-tui` versus OpenTUI as an RPC client of `pi --mode rpc`. Pick one, then build checkpoints (git-checkpoint example), best-of-N worktrees (child `pi` processes per `git worktree`), and sandboxing (container first, per Pi's own `containerization.md`).

## 5. Sources

READ (local clones, fetched 2026-11-02):
- Pi: `ref/pi-mono/README.md`, `LICENSE`, `package.json`, `packages/coding-agent/package.json`, `docs/{extensions,custom-provider,models,providers,mcp,security,sessions,compaction}.md`, `examples/extensions/{permission-gate.ts,subagent/README.md}` and directory listing, `packages/ai/src/providers/opencode.ts`, `opencode-headers.ts`, `opencode.models.ts`, `packages/ai/catalog/README.md`, `catalog/providers/opencode.ts`, directory listings of `packages/*/src`, line counts by `wc -l`.
- Codex: `ref/codex/LICENSE`, `NOTICE`, `codex-rs/model-provider-info/src/lib.rs` (lines 105-145, 150-230), crate listing, `hooks/src/events/` listing, `tui/Cargo.toml`, line counts.
- Gemini CLI: `ref/gemini-cli/LICENSE` header, `packages/core/src/core/contentGenerator.ts` (lines 60-215), `packages/cli/package.json` (ink fork), directory listings of `core/src/{hooks,policy,sandbox,agents}`, line counts.
- mini-SWE-agent: `LICENSE.md`, `src/minisweagent/agents/default.py` (full), `agents/interactive.py` (header), listings, line counts.
- Crush `LICENSE.md` (head and lines 28-43), `go.mod` (catwalk); Goose and Crush and Aider line counts and directory listings; Aider last-commit date via `git log` in my own fresh clone.
- RIFT: `rift-v2/opencode/packages/core/src/plugin/provider/opencode.ts` (grep), `core/test/plugin/provider-opencode.test.ts:1608-1623`.
- Repo metadata (licence, stars, open issues, pushed_at, archived, 30-day commit counts since 2026-10-03, contributor counts) from `gh api repos/...` run 2026-11-02. Contributor numbers are from the Link-header page count with `anon=1`, so approximate.

SUMMARY/SNIPPET: none used. NOT MEASURED: memory/CPU/startup of every candidate; Pi RPC-mode UI completeness; behaviour (not just file names) of Pi session share, cache warmer, and `durable`/`chord` packages; whether OpenCode Zen accepts `"public"` through Pi.
