# RIFT latency: where the time goes and how to cut it

Investigated 2026-10-21. No source code was changed. Paths are relative to `opencode/packages/`.
"Upstream" means OpenCode v1.18.29 source (scratchpad `oc/packages`) and the `/opt/homebrew/bin/opencode`
1.18.31 binary. This builds on `docs/research/rift-speed.md` and does not repeat it.

## Executive summary

1. **On the request path, RIFT and upstream now take the same time.** RIFT adds no code between
   steps that costs more than upstream's. Measured on `opencode/big-pickle`:
   - The time from "step starts" to "LLM stream opens" is 12 to 60 ms per step in RIFT and 30 to 40 ms
     upstream.
   - Boot to the first LLM call is 0.69 to 1.04 s in RIFT and 1.13 to 4.19 s upstream.
   - Once background verification shipped, the wait after the loop dropped to 0.01 s in every run.
2. **Model calls and the network take up 95 to 99% of wall time in both tools.** Each model call
   took 3 to 10 s when it went well. Three of the six runs hit `ECONNRESET` mid-stream, and each
   reset cost 10 to 18 s (RIFT) or 203 s (upstream oc2) before the retry. Those resets, not RIFT,
   are why the runs took 8.7 s to 222 s for the same task.
3. **The stream, the processor and the TUI's render path match upstream byte for byte.**
   - `opencode/src/session/processor.ts` and `core/src/session/projector.ts` are identical apart
     from a one-line `share_url` null fix.
   - The TUI's 16 ms event batching is identical (`tui/src/context/sdk.tsx:85-88`).
   - So "upstream feels instant" is not explained by streaming or rendering differences.
4. **The real wins left are at the network and provider layer, plus a few RIFT-only items:**
   - 300 s header and chunk timeouts (`opencode/src/provider/provider.ts:1877-1878`) let a dead
     socket hang a turn for minutes.
   - RIFT's expired-key fallback (`provider.ts`, `publicOnExpiredKey`) pays a full rejected round
     trip before every Zen call when a stale key is in the environment. A rejected request measured
     0.87 to 0.98 s cold and about 0.4 s on a warm connection.
   - Title generation competes with the first main call on the same free-tier provider.
   - The first request pays about 0.5 s of TLS setup (measured `time_appconnect` 0.49 to 0.57 s to
     opencode.ai). Nothing pre-warms that connection.
5. **New bug found: background verification never finishes under `rift run`.** In all three RIFT
   runs, "verification" is logged and "disposing instance" follows 4 ms later. The forked fiber is
   interrupted when the instance is disposed, so headless runs get no checks
   (`opencode/src/session/prompt.ts:2160-2162`). The prior report said to keep blocking mode for
   `rift run`, and that part was not done.

## Measurements

The task was `create hello.ts that prints hi and run it with bun`. Each run used a fresh git repo
whose `package.json` has `test: bun test` and `typecheck: echo ok`. The model was `opencode/big-pickle`,
with `OPENCODE_API_KEY` unset. I alternated rift and upstream, three runs each.

| Run | Wall (s) | Boot to first LLM (s) | Steps | Harness gap per step (ms) | Stream resets | After loop (s) |
|---|---|---|---|---|---|---|
| rift1 | 23.7 | 1.04 | 3 | 654, 27, 24 | 0 | 0.01 |
| rift2 | 117.5 | 0.69 | 3 (+4 retries) | 493, 39, 27 | 4 (ECONNRESET, about 10 to 18 s each) | 0.01 |
| rift3 | 8.7 | 0.73 | 3 | 530, 59, 34 | 0 | 0.01 |
| oc1 | 104.8 | 1.13 | 4 | 630, 40, 33, 33 | slow model | 0.01 |
| oc2 | 222.2 | 4.19 | 5 | 3652, 34, 30, 32 | 1 (hung 203 s before the reset) | 0.01 |
| oc3 | 94.6 | 1.74 | 5 | 1196, 33, 32, 32 | slow model | 0.00 |

How to read the table:

- **Harness gap** is the time from the `loop step=N` log line to the main-model `stream` line. It is
  RIFT's own per-step overhead. The first step includes message conversion, tool resolution, the
  system prompt and, in RIFT, the `git status` baseline (`prompt.ts:1574`). RIFT's first step is
  0.5 to 0.65 s, against 0.63 to 3.6 s upstream. Later steps are under 60 ms in both.
- **Tool overhead.** A `write` costs 15 to 310 ms from permission to the next loop in both tools.
  Most of that is `snapshot.track()` (`opencode/src/session/processor.ts:436`), a `git add` and
  `write-tree` into the snapshot repo. A `bash` call of `bun run hello.ts` costs about 100 ms.
  These numbers are the same in RIFT and upstream, because `snapshot/index.ts`, `tool/shell` and
  `processor.ts` are unchanged.
- **First output in `run` mode:** RIFT printed its first stdout at 4.2 to 16.7 s, about when the
  first tool ran. Upstream's `run` printed nothing until it finished (first stdout was within
  0.1 s of the end in all three runs). RIFT's `run-print.ts` already streams, so it feels faster here.
- **Variance:** wall time varied 25x within each tool, all from the network and the model. Three runs
  are not enough to rank total time. The per-phase numbers above are stable.
- **Startup:** `rift --version` takes 0.01 to 0.02 s, against 0.31 to 0.32 s for upstream's npm
  shim. Config load, skills (117 of them, about 0.03 s) and the watcher add up to about 0.3 s before
  the loop starts. LSPs and formatters are off unless configured, as upstream
  (`opencode/src/lsp/lsp.ts:151`, `opencode/src/format/index.ts:120`).
- **models.dev:** the refresh timed out after 10 s in one run (`Failed to fetch models.dev`). It runs
  forked (`core/src/models-dev.ts:257`) and did not block anything, because the disk cache was there.
  It blocks only on a cold cache (`models-dev.ts:217-229`).

### Rerun it

The harness is in the scratchpad at
`/private/tmp/claude-501/-Users-shiv-Developer-RIFT-Code/adcdaf8a-14b0-47ba-be36-1062be8e02fc/scratchpad/lat/`.

```sh
L=/private/tmp/claude-501/-Users-shiv-Developer-RIFT-Code/adcdaf8a-14b0-47ba-be36-1062be8e02fc/scratchpad/lat
bash $L/runall.sh                 # 3x rift + 3x upstream, alternating; writes $L/<label>.log
python3 -I $L/gaps.py $L/*.log    # boot, per-step harness gap, model+tool time, tail after loop
python3 -I $L/../parse.py $L/rift*.log   # prior report's phase parser
# one config: python3 -I $L/bench.py label /Users/shiv/.rift/bin/rift   (extra args pass through to `run`)
```

Gotchas when rerunning:

- `bench.py` sets `PWD` to the temp repo. `rift run` uses `$PWD` instead of the process cwd, so
  without this it writes into the caller's directory.
- It also closes stdin. With stdin open, `rift run` hangs after `init`, waiting on it.
- `opencode` on `PATH` is a symlink to `rift` (`~/.rift/bin/opencode -> rift`). Upstream has to be
  called as `/opt/homebrew/bin/opencode`.

## What RIFT adds, call by call (versus upstream)

| Addition | Where | Blocking? | Cost |
|---|---|---|---|
| `git status --porcelain` baseline at the start of every turn | `opencode/src/session/prompt.ts:1574` | Yes, before step 1 | About 10 ms on small repos. It scales with repo size, and on large monorepos it can be 100 ms or more (not measured here). |
| Vibe planner call (when `vibe_mode` is on) | `prompt.ts:1806-1846` | Yes | One full model call before any work. It has the full system context but no tools. |
| Vibe reviewer and revise calls per step | `prompt.ts:1648`, `2039-2080`, `vibe_review_max_rounds` default 2 (`2061`), `vibe_max_attempts` default 2 (`2010`) | Yes | 1 to 3 extra calls per step. The diff in the system prompt defeats caching (see the prior report). |
| Title generation | `prompt.ts:276-353`, forked at `1767-1771` | No | It runs at the same time as the first main call on the same provider. On a free or rate-limited tier, the two compete for the same quota. In 3 of 3 RIFT runs it failed ("free tier can only be used from...", plus ECONNRESET). |
| Verification: checks, claims call, browser, graph evidence | `prompt.ts:1382-1545`, forked at `2160-2162` | No, by default | Checks run in sequence (`1474`) and still use CPU while the next turn runs. The claims call now uses the small model with `tools: {}` (`1328-1365`). The browser check takes up to 30 s (`verify.ts:440`). Each check calls `publish()`, which writes a message part to the DB and the TUI. |
| Task-state save | `prompt.ts:2163`, `opencode/src/session/task-state.ts:256-300` | No | `git branch` and `git status`, plus one file write per turn. |
| Compaction prune | `prompt.ts:2164` | No | Same as upstream. |
| `graphwrite` nudge in the environment block | `opencode/src/session/system.ts:57` | Indirectly | It invites extra tool round trips (2 to 10 s each on this model) on multi-step builds. |
| Brain Rot prompt | `prompt.ts:793-801` | n/a | Only adds system tokens when it is on. |
| MCP catalogue and `mcp_search` | `opencode/src/session/tools.ts` (`mcpCatalog`) | Per step | It reads `mcp.tools()` and `mcp.status()` every step, which is cheap. `mcp_search` calls `mcp.settle()`, which waits for every server that is still connecting. |
| `publicOnExpiredKey` | `opencode/src/provider/provider.ts` (Zen loader, `envOnly`) | Yes, per request | With an expired key in the environment, every Zen request costs 401, then reading the body, then a second request. That is about 0.4 to 0.9 s per call (measured round trip of a rejected request). |
| Session status strip and blocked-session memo | `tui/src/app.tsx` (`blockedSessions`), `tui/src/component/session-status-strip.tsx:18-30` | TUI | It scans every message's parts for each live session whenever parts are added. This is cheap now and grows with session length. |

**Unchanged from upstream (checked by diff):**

- `session/processor.ts`, `snapshot/index.ts`, `tool/shell/*` and the edit and write logic
  (only description strings changed).
- `core/src/session/projector.ts`, so each delta causes the same DB writes as upstream.
- The TUI's `sdk.tsx` event batching (16 ms), apart from the sticky update event.
- `session/retry.ts` delays (2 s initial, x2, 30 s cap without headers, `retry.ts:26-31`).
- `models-dev.ts`.

RIFT also removed some upstream weight:

- The GitLab workflow model and OTel tracer wiring in `session/llm.ts`.
- Code mode.
- The per-family 7 to 15 KB prompts (`system.ts`).
- The console-state fetch at TUI boot.
- The provider list is deferred until after first paint (`tui/src/context/sync.tsx`, around
  lines 520-524).

## Ranked opportunities

Each item gives the change, the location, the expected gain, the risk and the effort. They are
ordered by expected gain for a typical interactive user.

### (a) Delete or turn off by default

| # | Change | Where | Gain | Risk | Effort |
|---|---|---|---|---|---|
| a1 | Turn off the claims check by default (`verify_claims: false`). Keep the deterministic checks. | `core/src/v1/config/config.ts:126`, `prompt.ts:1451` | One fewer model call per editing turn. It is background now, but it still uses rate-limit quota and tokens that compete with the next turn. | You lose the summary-versus-diff check. | Trivial |
| a2 | Drop the `graphwrite` nudge, or show it only when a todo or plan has 3 or more steps. | `system.ts:57` | 0 to several tool round trips per build, at 2 to 10 s each. This is the largest RIFT-caused cost to wall time that is still on the critical path. | Fewer evidence nodes. | Trivial |
| a3 | Skip title generation when the main model is a free or rate-limited tier, or when no separate `small_model` is set. Use the first-message fallback that already exists (`prompt.ts:343-345`). | `prompt.ts:303-340`, `1767` | It stops competing with the first request. It failed in 3 of 3 runs anyway. | Plainer titles. | Small |
| a4 | Turn off the browser check by default, and run it only when `verify_browser_url` is set. | `prompt.ts:1504-1512`, `verify.ts:433-470` | Up to 30 s of headless Chromium per UI turn, in the background but using CPU and RAM. | UI breakage is caught later. | Trivial |
| a5 | Keep Vibe Mode off (it already is), and default `vibe_review_max_rounds` to 1 when it is on. | `prompt.ts:2061` | 1 fewer reviewer call per rejected step. | Weaker review. | Trivial |

### (b) Make lazy or background

| # | Change | Where | Gain | Risk | Effort |
|---|---|---|---|---|---|
| b1 | **Fix verification under `rift run`.** Block when the session is non-interactive (the `run` command), or make dispose wait on the verification fiber. | `prompt.ts:2160-2162`, `opencode/src/cli/cmd/run.ts` | Correctness. Today headless runs silently get no checks. With this fixed, `rift run` would take 1 s plus the claims time longer (prior report). | None. | Small |
| b2 | Move the `git status` baseline off the critical path. Fork it at turn start and join it only in `runVerification`. | `prompt.ts:1574-1576`, used at `2160` | 10 to 200+ ms per turn, depending on repo size. | The baseline must be captured before the first edit. Join it before the first edit tool runs, or take it from the step-start snapshot (`processor.ts:102`). | Small |
| b3 | Give background verification low priority. Run the checks with `nice`, and cancel the in-flight verification when a new user prompt arrives in the same session. | `verify.ts:212` (spawn), `prompt.ts:2162` | The next turn's tools and the TUI are not starved by `tsc` or tests. | Stale reports. Mark them "superseded". | Small |
| b4 | Make `mcp_search` stop waiting on `mcp.settle()`: return what is loaded now, plus a "still connecting" note. | `session/tools.ts` (`mcp_search` execute) | Up to the MCP connect timeout, on a tool call that waits for a slow server. | The model may retry the search. | Small |
| b5 | Make `snapshot.track()` cheaper: skip it after read-only tools, or run it in the background and join it before the next step's patch. | `processor.ts:425-472` (upstream code) | 30 to 300 ms per editing step (measured 75 to 310 ms after a write). | Undo and revert accuracy. It must stay correct. | Medium |

### (c) Make faster

| # | Change | Where | Gain | Risk | Effort |
|---|---|---|---|---|---|
| c1 | **Lower the default `headerTimeout` and `chunkTimeout` from 300 s** to about 30 s for the header and 60 s idle between chunks, and keep the retry. | `provider.ts:1877-1878` (and `OPENAI_HEADER_TIMEOUT_DEFAULT` at `provider.ts:35`) | Turns a 203 s hang (oc2) into about 30 to 60 s and a retry. This is the biggest saving on the worst cases. | Slow reasoning models with long silent thinking may be cut off. Exempt models flagged `reasoning`, or count reasoning deltas as chunks. | Small |
| c2 | **Remember an expired key.** After the first 401 "expired", use `public` for the rest of the process instead of trying the dead key first on every request. | `provider.ts`, `publicOnExpiredKey` | About 0.4 to 0.9 s per Zen call for anyone with a stale `OPENCODE_API_KEY`, which is this user's shell. | None. | Trivial |
| c3 | Make the first retry faster after a connection reset. Retry `ECONNRESET` or "socket closed" at about 250 ms instead of the 2 s `RETRY_INITIAL_DELAY`, since a reset is a dead socket, not overload. | `session/retry.ts:26`, `47-75` | About 1.75 s per reset. Three of six runs had resets. | Small risk of a retry storm. Apply it only to the first retry. | Small |
| c4 | Cache `Verify.resolve`, the detected checks, per session, and skip checks on turns that only touched docs. | `verify.ts:156-198` | Small per turn. Docs-only turns get no checks at all. | Low. | Small |
| c5 | Run typecheck and lint in parallel in the background report. | `prompt.ts:1474` | The report is ready sooner, by max instead of the sum. | Shared caches. | Small |

### (d) Upgrade dependencies

RIFT pins the same versions as upstream 1.18.29, except that `@ai-sdk/openai` is 3.0.88, against
3.0.84 upstream. Upgrading is therefore not a RIFT-specific regression. Here is how far behind
the current npm releases the pins are (`npm view`, 2026-10-21):

| Package | Pinned | Latest | Note |
|---|---|---|---|
| `ai` | 6.0.168 | 7.0.148 | Major version. A breaking migration. |
| `@ai-sdk/anthropic` | 3.0.111 | 4.0.85 | Major version, follows `ai` 7. |
| `@ai-sdk/openai` | 3.0.88 | 4.0.99 | Major version. |
| `@ai-sdk/openai-compatible` | 2.0.41 | 3.0.75 | Major version. |
| `@ai-sdk/google` | 3.0.73 | 4.0.102 | Major version. |
| `effect` | 4.0.0-beta.83 | 4.0.5 | Beta to stable. |
| `@opentui/core` and `@opentui/solid` | 0.4.5 | 0.6.6 | The renderer. This is the most likely place for render-speed gains. |
| `solid-js` | 1.9.10 | 1.9.17 | Patch releases. |
| `@modelcontextprotocol/sdk` | 1.29.0 | 1.32.1 | Minor releases. |
| `drizzle-orm` | 1.0.0-rc.2 | 0.45.4 (latest tag) | RC line. Do not change. |
| bun | 1.3.14 (`packageManager`) | 1.4.3 installed locally | The shipped binary's runtime should be checked. |

I did not verify specific performance claims in these projects' changelogs. The npm registry was
slow, and models.opencode.ai timed out from this machine. Treat (d) as "check the opentui and
effect release notes first", not as a measured gain. Upgrading the AI SDK to 7.x is a large
migration with no latency gain shown here.

### (e) Perceived-latency tricks

| # | Change | Where | Gain | Risk | Effort |
|---|---|---|---|---|---|
| e1 | **Pre-warm the provider connection** as soon as the TUI opens or the user starts typing: open TLS to the selected model's base URL (Bun's `fetch.preconnect(url)`, https://bun.sh/docs/api/fetch#preconnect-to-a-host). | the TUI prompt focus, or the server start in `opencode/src/cli/cmd/tui.ts` | About 0.5 s off the first token of every session (measured TLS handshake 0.49 to 0.57 s). | None. | Small |
| e2 | Show an immediate "thinking" placeholder and the step-start state the moment the request is sent. This is upstream behavior, so check that the RIFT strip does not hide it. | `tui/src/component/session-status-strip.tsx` | Perceived latency only. | None. | Trivial |
| e3 | **Speculative typecheck:** start the detected typecheck as soon as the last edit tool completes, while the model writes its final summary. | `prompt.ts`, around the loop's tool-result handling | The verification report is ready when the reply ends. | Wasted work if the model edits again. | Medium |
| e4 | Prefetch the session's system context (skills, instructions, env) while the user types, so step 1's 0.5 to 0.65 s harness gap shrinks. | `prompt.ts:781-801` (`loadSystemContext`) | Up to about 0.3 to 0.5 s on the first step. | Stale instructions if a file changes. Invalidate on watcher events. | Medium |
| e5 | Show a retry countdown ("connection reset, retrying in 2 s") in the TUI, so a stalled stream does not look like a hang. | `session/retry.ts`, TUI status | Perceived latency during the long stalls seen here. | None. | Small |

## Fast-mode proposal

The proposal is one preset, `"mode": "fast"`, or a `--fast` flag, or the `RIFT_FAST=1` environment
variable. Each setting below already exists unless marked *new*.

```jsonc
{
  // verification: keep only the deterministic checks, in the background, capped
  "verify_claims": false,              // a1: no claims model call
  "verify_browser_url": null,          // a4 (*new*: "verify_browser": false to stop auto-detecting pages)
  "verify_timeout_ms": 120000,         // cap hung checks at 2 min
  "verify_background": true,           // already the default (b1 must still block in `rift run`)
  // agent behaviour
  "vibe_mode": false,
  "vibe_review_max_rounds": 1,
  "brain_rot": false,
  "task_state": false,                 // skip the per-turn task-state save (git + file write)
  // *new* knobs this report proposes
  "graph_nudge": false,                // a2: drop the system.ts:57 graphwrite nudge
  "title": "first-message",            // a3: no title model call
  "provider": { "*": { "options": { "headerTimeout": 30000, "chunkTimeout": 60000 } } }, // c1
  "preconnect": true                   // e1
}
```

What fast mode would not turn off: snapshots (undo depends on them), the deterministic checks
themselves, and permissions.

## What you can do today with no code changes

- Unset the stale `OPENCODE_API_KEY` in your shell. This removes the extra rejected round trip
  before every Zen call (item c2).
- Set `"verify_claims": false` and `"verify_timeout_ms": 120000`.
- Set per-provider timeouts. These options are read at `provider.ts:1877-1878`:
  `"provider": {"<id>": {"options": {"headerTimeout": 30000, "chunkTimeout": 60000}}}`.
- Set a fast `"small_model"`, or add a `title` agent with its own model, so titles stop competing
  with the main call on a free tier.
- Choose a model and provider with low and steady latency. In these runs the network and the model
  accounted for 95 to 99% of the time.
