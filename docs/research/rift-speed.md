# Why RIFT is slow to finish coding tasks, and how to speed it up

Investigated 2026-10-21. No source code was changed. Paths are relative to
`opencode/packages/opencode/` unless they say otherwise. Upstream means OpenCode v1.18.29 for the
source diff and `/opt/homebrew/bin/opencode` 1.18.31 for the timings.

## Summary

1. **Model round-trips take up most of the time in both tools.** Each call to the main model took
   2 to 4 s with `opencode/big-pickle`. A trivial task needs 3 to 5 calls. The agent-loop time
   ranged from 7.6 s to 37 s for the same prompt, and that spread comes from model latency, not
   from RIFT.
2. **The biggest overhead RIFT adds is the "claims" pass after the turn.** It is one extra,
   uncached call to the full session model, and it blocks the turn. It took 2.8 to 6.0 s per run,
   about 25 to 35% of a short task (`src/session/prompt.ts:1520-1534`, `1307-1371`).
3. **The verification checks run one after another and block the turn.** Typecheck, lint and test
   run in sequence (`prompt.ts:1441`), followed by graph evidence commands (`prompt.ts:1490-1512`)
   and an optional headless browser load of up to 30 s (`prompt.ts:1478-1485`,
   `verify.ts:440`). Each command can run for up to 10 minutes (`prompt.ts:1437`). In the toy
   repo this took 0.9 to 1.1 s. In a real project with `tsc`, `eslint` and a test suite, it is
   tens of seconds to minutes on every turn that edits files.
4. **Tests run twice.** The system prompt tells the model to run the project's tests, typecheck
   and lint (`src/session/prompt/rift.txt:14`). RIFT then runs the same commands again after the
   turn. On a real project this doubles the slowest part of a turn, and the model's own runs also
   cost extra round-trips.
5. **Vibe Mode (off by default) multiplies the model calls.** It adds a planner call, a reviewer
   call after every step (up to 2 rejected rounds, `prompt.ts:2050`), executor retries (up to 2,
   `prompt.ts:1999`) and revise calls. The reviewer puts the diff and file contents into the
   *system* prompt (`prompt.ts:1663-1667`), which defeats prefix caching, so the whole transcript
   is billed again, uncached, on every review.
6. **RIFT does not add slowness at startup or between steps.** RIFT reached its first model call
   in about 1.0 s, against 1.7 s for upstream. Snapshot tracking costs 40 to 80 ms per step. The
   system prompt and tool descriptions are much smaller than upstream's (see the measurements
   below). Provider caching is the same as upstream.

## Measurements

The task was `create hello.ts that prints hi and run it with bun`, using model
`opencode/big-pickle`. Each run used a fresh git repo whose `package.json` has the scripts
`test: bun test` and `typecheck: echo ok`. Runs were `rift run --print-logs`.

I parsed the logs with a script (`scratchpad/parse.py`, next to the speed folder). The phases are:

- **Boot to first LLM:** from process start to the first main-model stream.
- **Agent loop:** from the first stream to the "exiting loop" log line.
- **Checks:** from "verification" to "verification claims check".
- **Claims LLM:** from "verification claims check" to dispose.

| Run | Config | Wall (s) | Boot to first LLM | Steps | Agent loop | Checks | Claims LLM | After loop |
|---|---|---|---|---|---|---|---|---|
| rift1 | default | 18.0 | 1.04 | 3 | 9.3 | 1.0 | 6.0 | 7.0 |
| rift2 | default | 19.0 | 0.95 | 3 | 12.5 | 0.9 | 4.0 | 4.9 |
| rift3 | default | 16.0 | 0.95 | 3 | 10.2 | 0.9 | 3.3 | 4.2 |
| rift4 | default | 13.0 | 0.95 | 3 | 7.6 | 1.0 | 2.8 | 3.8 |
| rift5 | default | 45.4 | 1.15 | 5 | 37.1 | 1.1 | 5.3 | 6.5 |
| rnc1 | `verify_claims:false` | 13.8 | 0.99 | 3 | 11.3 | 0.9 | 0 | 0.9 |
| rnv1 | `verify:false` | 15.4 | 0.98 | 5 | 13.9 | 0 | 0 | 0 |
| rnv2 | `verify:false` | 10.5 | 0.96 | 3 | 9.0 | 0 | 0 | 0 |
| rnv3 | `verify:false` | 18.7 | 1.09 | 3 | 16.9 | 0 | 0 | 0 |
| ocy1 | upstream | 15.5 | 1.73 | 5 | 12.5 | n/a | n/a | 0 |
| ocy2 | upstream | 10.7 | 1.76 | 3 | 7.9 | n/a | n/a | 0 |
| ocy3 | upstream | 38.7 | 5.54 | 5 | 32.1 | n/a | n/a | 0 |

What the table shows:

- **RIFT's fixed overhead per editing turn on this toy repo is about 4 to 7 s.** About 1 s of that
  is the checks and the rest is the claims call. There were no other measurable sleeps or waits.
- **The run-to-run variance is about 4x and comes entirely from the model.** For example, rift4
  took 13 s and rift5 took 45 s with the same prompt. Five runs per configuration are not enough
  to rank RIFT against upstream on total time. The phase-level numbers are reliable.
- **Steps per task were the same in both tools.** Both took 3 to 5 steps, usually write, then run,
  then a final summary.
- **Title generation never blocked a run.** It runs in parallel on a small model
  (`prompt.ts:303-330`) and failed harmlessly here because of the key below.
- **About the upstream runs:** the shell has an expired `OPENCODE_API_KEY` (see
  `docs/research/opencode-expired-key.md`). Upstream failed with it set (runs oc1, oc2, ocx1 and
  ocx2, all under 5 s, all errors), so the upstream runs above used
  `env -u OPENCODE_API_KEY`. RIFT runs 1 to 3 had the key set and still worked.

## Where the time goes in one turn

- **The agent loop** is `runLoop` (`prompt.ts:1549`). It makes one main-model stream per step,
  and tools from a single step run as the AI SDK streams them. This is the same as upstream.
- **Side calls:**
  - Title generation runs on a small model, in parallel (`prompt.ts:303-330`).
  - The summary runs forked (`prompt.ts:1935`).
  - Task-state save and prune run forked (`prompt.ts:2149-2150`).
  - Verification runs **blocking**, as `yield* runVerification` (`prompt.ts:2148`). The session
    stays busy, and `rift run` does not exit, until it finishes.
- **The claims pass** (`checkClaims`, `prompt.ts:1307-1371`):
  - It uses the session model, or the Vibe planner (`prompt.ts:1328-1335`), never the small model.
  - It sends the full turn diff, up to 100 KB (`verify.ts:299`).
  - It passes the full tool definitions with `toolChoice: none` (`prompt.ts:1354-1355`). That
    adds input tokens and has no cache prefix in common with the main conversation.
  - It retries twice (`prompt.ts:1356`).
- **Check detection** covers `typecheck`, `lint` and `test` from package.json, plus Go, Cargo and
  pytest (`verify.ts:51-142`). In a monorepo it covers each edited package (`verify.ts:156-198`),
  and everything runs in sequence (`prompt.ts:1441`).
- **The system prompt:**
  - `rift.txt` is 1.3 KB, against 8.2 to 8.5 KB for upstream's `anthropic.txt` and
    `default.txt` (`system.ts:6-21`).
  - All tool `.txt` descriptions together are 4.2 KB, against 15.1 KB upstream.
  - Skills are listed by name only (`system.ts:84`).
  - RIFT already sends fewer input tokens per step than upstream, so the prompt is not a time
    sink.
- **The graph nudge** in `system.ts:57` asks the model to call `graphwrite` early and keep it up
  to date on multi-step builds. Each update is another tool call and often another round-trip.
  Each node's `checks` also become evidence commands that run after the turn.
- **Retries** (`session/retry.ts`): RIFT adds support for Google's `RetryInfo` delays and only
  uses exponential backoff when there are headers. RIFT does not add sleeps.
- **Caching** (`provider/transform.ts:358-483`) is unchanged from upstream:
  - Explicit `cacheControl` markers go on the first 2 system messages and the last 2 messages for
    Anthropic, Claude-via-anything, Bedrock and Alibaba.
  - OpenAI-style providers get a `promptCacheKey` set to the session ID (`transform.ts:1321`,
    `1368`).
  - Gemini relies on its own implicit caching.
- **Startup**, from the rift1 log:
  - Config load takes about 0.07 s, and LSPs and formatters are disabled.
  - Loading 117 skills, with many duplicate-name warnings from `~/.claude`, takes about 0.07 s.
  - The project copy refresh takes 0.24 s.
  - The watcher (fs-events) starts quickly.

## Ranked ideas

### Quick wins (defaults and config, small code changes)

| # | Change | Where | Expected gain | Risk |
|---|---|---|---|---|
| 1 | Run the claims call on the **small model** by default, falling back to the session model. Pass `tools: {}` instead of the full tool set, and cap the diff at about 20 KB. | `prompt.ts:1328-1335`, `1354`; `verify.ts:299` | Cuts the 3 to 6 s per editing turn to about 1 s. Fewer tokens. | A weaker model may miss mismatches. Keep the session model as a config option. |
| 2 | **Run the claims call at the same time as the checks** instead of after them. It only needs the diff, which already exists when the turn ends. | `prompt.ts:1438-1535` (wrap both in `Effect.all` with concurrency) | Saves min(checks, claims) per turn: the whole claims time on small repos, or the whole check time on large ones. | Low. Watch the `publish` ordering. |
| 3 | **Do not re-run checks the agent already ran successfully this turn.** Compare against the turn's completed `bash` tool calls with the same command and exit code 0, run after the last edit. Or change `rift.txt:14` so the model leaves full-suite runs to RIFT. | `prompt.ts:1397-1406`, `session/prompt/rift.txt:14` | Removes one full test, typecheck and lint pass per turn. On real projects this is the biggest gain (tens of seconds or more). | You must be sure no edit happened after the agent's run. Changing the prompt alone is low risk. |
| 4 | **Make verification non-blocking** for interactive use: fork it, publish the report when it is done, and let the next user prompt start. Keep it blocking for `rift run`. | `prompt.ts:2148` | The TUI is ready for the next prompt as soon as the model stops. | The next turn could edit files during checks. Cancel or rebase the report. |
| 5 | Lower the default `verify_timeout_ms` from 10 min to about 2 min, and set a total time budget for the whole report. | `prompt.ts:1437` | Caps worst-case hangs, such as watch-mode tests. | Slow test suites show `timed_out`. |
| 6 | Make the `graphwrite` nudge apply only when a plan has more than about 3 steps, or remove it. | `system.ts:57` | Fewer tool round-trips on medium builds. | Fewer evidence nodes. |

### Deeper changes

| # | Change | Where | Expected gain | Risk |
|---|---|---|---|---|
| 7 | **Run independent checks in parallel.** Run typecheck and lint at the same time, then test. Running packages in a monorepo in parallel also helps. | `prompt.ts:1441-1476` | Check time drops to roughly the slowest check, instead of the sum. | The shared build cache and lockfile is the reason it is sequential now. Allow parallel runs only for the read-only typecheck and lint. |
| 8 | **Narrow the scope of checks.** Run only the tests related to the edited files, such as `bun test <file>`, `vitest related`, `jest --findRelatedTests` or `go test ./pkg/...`, and run the full suite only on request or on the final turn. | `verify.ts:109-198` | Large gains on big repos. | Misses regressions in other parts of the code. |
| 9 | **Make Vibe review cache-friendly and cheaper.** Put the diff and file contents in the final *user* message, not the system prompt, so the shared prefix with the executor stays cached. Use the small model for low-risk steps, and skip the review when RIFT's checks already passed for that step. | `prompt.ts:1660-1680`, `2028-2080` | Large token and latency cuts in Vibe Mode, roughly one fewer full-context call per step. | Review quality may drop on the small model. |
| 10 | **Cache detection results** (`Verify.resolve`, `packageRunner`) per session, and skip the whole checks phase when the turn only touched docs or non-code files. | `verify.ts:91-198` | Small saving per turn. Large saving on docs-only turns. | Low. |
| 11 | **Speculative or early verification:** start the typecheck as soon as the last edit lands, while the model is still writing its final summary step. | `prompt.ts` loop around `1935-2148` | Hides check time behind the final 2 to 4 s model call. | Wasted work if the model edits again. |
| 12 | Encourage parallel tool calls more strongly. The prompt mentions them once (`rift.txt:11`). Several reads, or a write followed by a run, could go in one step. | `session/prompt/rift.txt` | Fewer round-trips, which is the main cost. | Depends on the model. |
| 13 | Deduplicate skill discovery: 117 skills with about 15 duplicate warnings, from `~/.claude/skills/.trash` and the vercel `upstream/` copies. Skip `.trash` directories. | `src/skill/index.ts` | Under 0.1 s. Mostly less noise. | None. |

## What you can do today, with no code changes

Add these settings to `~/.config/opencode/opencode.jsonc`, or to the project's `rift.json`:

- **`"verify_claims": false`**: removes the extra model call, saving 3 to 6 s per editing turn
  (measured). You keep the real check output.
- **`"verify_claims_model": "google/gemini-2.5-flash"`**, or another fast model you have a key
  for: keeps the claims check and makes it much faster.
- **`"small_model": "<fast model>"`**: titles and other small calls go to it, and it avoids the
  failing `gpt-5.4-nano` call through the expired Zen key.
- **`"verify_commands": ["bun run typecheck"]`**, or a fast subset such as a single test file:
  RIFT runs this instead of every typecheck, lint and test script it detects.
- **`"verify_timeout_ms": 120000`**: caps a hung check at 2 minutes.
- **`"verify": false`**: skips verification entirely for exploratory sessions. This gives up
  RIFT's main feature.
- In Vibe Mode, set `"vibe_review": false`, or `"vibe_review_max_rounds": 1`, and set a fast
  `executorModel`.
- **Choose a faster model.** It matters more than anything else: model latency was 70 to 90% of
  wall time in every run. Prefer models with prompt caching, such as Anthropic models, where RIFT
  adds cache markers.
- Clear `OPENCODE_API_KEY` from stale shells (see `opencode-expired-key.md`).
