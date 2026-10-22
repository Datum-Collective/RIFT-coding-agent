# RIFT verification: making it faster without catching less

Research only. No RIFT source was changed. This builds on `rift-speed.md` and `rift-latency-boost.md`
and does not repeat their findings except where new measurements change them.

Line references are to `opencode/packages/opencode/src/...` unless a full path is given.

## Executive summary

Verification already runs in the background (`session/prompt.ts:2160-2162`), so the user no longer waits
for it. But the total time spent on verification in one editing turn is much larger than the RIFT checks
alone, and most of it is repeated work. In two end-to-end runs of a trivial task ("add `sum()` to
`src/m140.ts` and a test", 150-module TypeScript project, `opencode/big-pickle`, foreground mode so it
could be timed):

| Where the time went | Run fg1 | Run fg2 | Notes |
|---|---|---|---|
| Agent's own "verify" step (model step that ran `bun test`, typecheck, lint) | 10.5 s (3.9 s of tools) | 7.1 s | `session/prompt/rift.txt:14` tells it to. |
| `graphwrite`-only model steps | 11.0 s (2 steps, 1074 output tokens) | 3.5 s (1 step) | 30% and 9% of the agent loop. Nudge at `session/system.ts:57`. |
| RIFT checks (`typecheck`, `lint`, `test`, one after another) | 7.0 s | 7.2 s | `prompt.ts:1467-1503`. Same commands the agent had just run. |
| RIFT graph evidence | 1.1 s | 3.9 s | Re-runs `typecheck` (fg1) or `typecheck` and `lint` (fg2) that the checks had just run. |
| Claims check | 0.8 s, failed | failed | The free tier rejects the tool-less call ("free tier can only be used from within OpenCode"). It is reported as "unreadable verdict". |
| **Total verification after the turn** | **8.1 s** | **11.1 s** | |
| Agent time *after its last edit* | 18.0 s | 17.5 s | Enough to finish all checks before the reply ends, if they started at the last edit. |

Each turn ran the project's typecheck 3 times, lint 2 to 3 times and the tests 2 times. Run in parallel
and scoped to the edit, the same checks take **0.18 s** instead of 7.0 s (see Measurements).

On real projects the numbers are larger and the scoping problem matters more:

- **RIFT's own package** (`packages/opencode`): an edit to `session/verify.ts` resolves to
  `bun run typecheck` plus `bun run test`. The typecheck (`tsgo --noEmit`) took 10 to 68 s depending on
  machine load. The full test suite took **262 s**, against **8.5 s** for the one test file that covers
  the edit. The suite also has **6 failures that exist before any edit**, so every turn that touches this
  package would report "failed", whatever the agent did.
- **A docs-only edit** to `docs/research/*.md` at the repo root resolves to `go vet ./...` and
  `go test ./...`, because the root has a `go.mod`. That is **15 s** of Go checks for a Markdown change.
- **A change in `packages/core`** runs only core's checks. `packages/opencode` imports core, but its
  typecheck does not run, so a breaking change to core's API is **not caught**.

Today's verification is slow for three reasons, and none of them is that the tools are slow:

1. **The same check runs 2 or 3 times**: once by the agent, once by RIFT and once more as graph evidence.
2. **It always runs the whole project**: every test file, every lint file and a full typecheck with no
   incremental state, even for a docs edit.
3. **It starts late and runs one check at a time.** Nothing starts until the turn ends, and then the
   checks run serially.

The biggest wins on what it catches are separate from speed. The claims prompt explicitly ignores claims
about commands (`prompt.ts:129-132`), yet "tests pass" when they don't is the core failure this system
exists to catch. Failures already present before the edit are not told apart from new ones. And results
arrive only after the agent has declared itself done.

## Ranked ideas

Impact is the time saved per editing turn on the measured projects. "Catch" means the effect on catching
"the agent said it's done but it's broken". Effort: S is under a day, M is 1 to 3 days, L is a week or
more.

### Tier 1: quick wins (S effort, high impact or correctness)

#### 1. Fix verification under `rift run` (correctness)
- **What**: `rift run` exits on the first `session.status: idle` event (`cli/cmd/run.ts:692-698`). Idle
  fires when `runLoop` returns, but verification is forked into the layer scope
  (`prompt.ts:214`, `2162`), so the instance is disposed before verification ends. The prior report saw
  dispose 4 ms after "verification". In this report's foreground runs (`verify_background: false`)
  verification completed (8.1 s and 11.1 s).
- **Fix**: add an env-based runtime flag, in the same style as `effect/runtime-flags.ts:46`, for example
  `RIFT_VERIFY_FOREGROUND`. `run.ts` sets it, and `prompt.ts:2161` treats it like
  `verify_background === false`. The fix that later items depend on is to make `rift run` print or emit
  the verification summary. Today the report is a text part on the assistant message, and `run` does not
  print it, as the `fg1.out` capture shows.
- **Gain**: none in speed. It costs the check time in `rift run`. Ideas 4 and 5 make that cost small.
- **Catch**: better. Headless runs get no verification at all today.
- **Risk**: low. **Effort**: S.

#### 2. Content-hash result cache, and dedupe evidence against checks
- **What**: key every check result on `(normalized command, cwd, worktree tree hash)`. The tree hash is
  already computed: `Snapshot.track()` returns a `git write-tree` hash of the whole worktree
  (`snapshot/index.ts:318-341`), and the processor records one per step (`session/processor.ts:102`,
  `436`). Before running a check or an evidence item, look it up and reuse a hit. Normalize
  `npm run X`, `bun run X`, `pnpm run X` and `yarn run X` to the script name. In fg2, evidence ran
  `npm run typecheck` and `npm run lint` right after the checks ran `bun run typecheck` and
  `bun run lint`.
- **Where**: `prompt.ts:1467-1503` (checks) and `1514-1539` (evidence). `Evidence.command`
  (`session/evidence.ts:134`) goes through `Verify.runCheck`, so one memoized `runCheck` covers both.
- **Gain**: 1.0 to 3.7 s per turn from evidence dedupe (measured). A turn that edits nothing new, or a
  retry with the same tree, costs 0 s instead of 6.8 s (measured re-run with no change).
- **Catch**: same. The result is identical for an identical tree, unless the check is not deterministic
  (network, time). Skip caching for evidence of kind `http`, `production` and `load`.
- **Risk**: low. Untracked, git-ignored inputs such as `.env` are not in the tree hash. Add the hash of
  the env files that the checks read, or accept the risk. **Effort**: S.

#### 3. Adaptive skip for non-code edits, and fix the root fallback
- **What**: classify the edited paths before `Verify.resolve` (`session/verify.ts:156`). If every file
  is docs or prose (`.md`, `.mdx`, `.txt`, `LICENSE`, images), skip the checks and claims, and keep only
  the scope warning. Separately, `resolve` walks up to the root and uses whatever it finds there. For
  `docs/x.md` in this repo that is `go vet` and `go test` (measured: 15 s). A file should pick a
  directory's checks only if that directory owns files of that kind: a `go.mod` for `.go` files, a
  `package.json` for JS and TS files, a `Cargo.toml` for `.rs` files.
- **Gain**: 15 s per docs turn here. Every docs-only turn becomes 0 s.
- **Catch**: same in practice. Markdown cannot break `go test`. Keep an escape hatch: run the checks
  when a doc file is an input to tests (snapshots, fixtures under `test/`).
- **Risk**: low. **Effort**: S.

#### 4. Run independent checks in parallel
- **What**: replace the loop at `prompt.ts:1467` with `Effect.forEach(..., { concurrency: "unbounded" })`,
  or a small cap such as 3.
- **The "sequential on purpose" comment** (`prompt.ts:1467`) is mostly unfounded for the commands RIFT
  detects:
  - `tsc --noEmit` and `tsgo --noEmit` write nothing. ESLint writes `.eslintcache` only with `--cache`.
    `bun test` and `vitest run` write nothing by default.
  - The Go build cache "is safe for concurrent invocations of the go command" (`go help cache`).
  - Cargo serializes itself. Running `cargo check` and `cargo test` together in a scratch crate printed
    "Blocking waiting for file lock on build directory" and both finished correctly.
  - The real risk is user scripts that write to a shared location. Examples are a `test` script that
    runs `build` first, or `tsc -b`, which emits `.tsbuildinfo` and outputs. Run checks in parallel only
    when the script body matches a known read-only pattern (`tsc|tsgo --noEmit`, `eslint`, `oxlint`,
    `biome check`, `bun test`, `vitest run`, `jest`, `go vet`/`go test`, `cargo`). Otherwise keep them
    sequential.
- **Gain**: measured 6.98 s down to 3.50 s (the wall time becomes the slowest check).
- **Catch**: same. One rule: report a cancelled check as "not run", never "passed". `notRun` already
  does this.
- **Risk**: CPU contention on big suites. Cap concurrency and run checks under `nice`, which is the
  prior report's b3. **Effort**: S.

#### 5. Stop telling the agent to run the full checks itself
- **What**: `session/prompt/rift.txt:14` says "Verify your work with the project's own test, lint and
  typecheck commands". Both runs did this, at a cost of one 7 to 10.5 s model step with 3.9 s of tools,
  and RIFT then ran the same commands again. Change the line to something like: "Run the narrowest test
  for what you changed. RIFT runs the full typecheck, lint and test suite after your turn and shows you
  the result." Ideally pair this with idea 7 (`verify` tool), so the agent can still get feedback during
  the turn.
- **Gain**: about 4 s of tools and often a whole model step (7 to 10 s) per turn.
- **Catch**: same or better. RIFT's run is authoritative, and the agent's runs are piped through `tail`,
  which hides their exit code (see idea 9). Worse only if the agent stops looking at failures. That is
  why ideas 6 and 7 matter.
- **Risk**: low. **Effort**: S.

#### 6. Feed failures back into the next turn
- **What**: the report is a non-synthetic text part on the *assistant* message (`prompt.ts:1431-1440`),
  so on the next turn the model sees it as something it wrote itself. If the report is still running when
  the user types, the model sees "queued". Instead, on the next prompt, if the latest report has
  failures, add a synthetic user part through `session/reminders.ts:15` (`SessionReminders.apply`):
  "RIFT verification of your previous turn: `bun run test` failed (output tail...). Fix this first or
  tell the user why not." Cap it at one reminder per failure set.
- **Also fix**: `taskState.save` is forked at the same moment as background verification
  (`prompt.ts:2163`). It picks the newest *finished* report (`session/task-state.ts:94-96`), which is
  the previous turn's, so `.rift/tasks/*/verification.json` is always one turn stale. Save the task state
  again when verification publishes `done: true`.
- **Gain**: none in speed. **Catch**: better. Failures are acted on rather than only displayed.
- **Risk**: low. **Effort**: S.

### Tier 2: the structural wins (M effort, highest impact)

#### 7. Run checks during the turn: speculative start at the last edit, plus an in-turn `verify` tool
- **What**: start the resolved, scoped checks (debounced, about 1.5 s) after each completed
  `edit`/`write`/`apply_patch` tool call. Cancel and restart them on the next edit. When the turn ends,
  join the in-flight run instead of starting a new one. Put the result in the cache from idea 2, keyed
  by the tree hash at start. If the tree hash at the end of the turn differs, re-run.
- Optionally expose a `verify` tool that returns the cached or in-flight result, so "run the checks"
  costs the agent one tool call that is usually already finished, instead of shelling out itself. This is
  what lets idea 5 drop the agent's own runs safely. It also lets failures reach the agent *before* it
  declares done, so it fixes them in the same turn.
- **Where**: `session/processor.ts` around the tool-result handling (the same place as the prior
  report's e3), the existing `TOOLS_THAT_EDIT` set (`session/verify.ts:51`), and `prompt.ts:2160`.
- **Gain**: the agent kept working for 17.5 to 18 s after its last edit in both runs, while the checks
  take 7 s serial, 3.5 s parallel, or 0.18 s scoped. The report is ready when the reply ends, so
  `rift run` (idea 1) gets verification at about 0 s extra.
- **Catch**: better. Failures can be fixed in the same turn. Same coverage.
- **Risk**: wasted CPU when the agent keeps editing. The debounce plus cancellation bounds it. Edits made
  through `bash` (`sed -i`, codegen) are not seen as edit tools, but the end-of-turn tree-hash
  comparison catches them. **Effort**: M.

#### 8. Scope checks to the edit
Run only what the edit can affect, with a full run as the backstop. The flags, checked against each
tool's docs or `--help`:

| Tool | Scoped form | Source | Measured |
|---|---|---|---|
| `bun test` | `bun test --changed[=<ref>]`: "Only run test files affected by changed files according to git" (local `bun test --help`, bun 1.4.3). Exact paths need `./` (https://bun.sh/docs/cli/test). | bun docs, `--help` | Full run 3.62 s, `--changed` 0.10 s (1 file). Editing the central `m10` selected 138 of 150 files, so it follows imports. |
| `bun test` | `--parallel[=N]` "Run test files in parallel using N worker processes. Implies --isolate." | `bun test --help` | 3.62 s down to 0.54-0.64 s. Can break suites that share ports or files, which is why RIFT's own suite uses `--max-concurrency`. |
| vitest | `vitest related <files> --run` and `--changed [since]`. These use static imports only: "It does not detect dynamic imports". | https://vitest.dev/guide/cli | 7.95 s down to 0.98 s |
| jest | `--findRelatedTests <files>`, `--onlyChanged`, `--changedSince`. These need "a static dependency graph (ie. no dynamic requires)". | https://jestjs.io/docs/cli | not measured |
| pytest | `--lf` re-runs only the last failures. By default, with no recorded failures, it "runs all tests". `pytest --testmon` selects tests by recorded coverage. | https://docs.pytest.org/en/stable/how-to/cache.html, https://testmon.org/ | not measured |
| tsc | `--incremental` saves "the project graph from the last compilation" to `.tsbuildinfo` (https://www.typescriptlang.org/tsconfig/#incremental). Put `--tsBuildInfoFile` in RIFT's state dir so the repo stays clean. | TS docs | Scratch project: 0.95 s down to 0.63 s. RIFT package (`tsgo`): 10-68 s cold down to 0.9-2.5 s warm. |
| tsgo | `@typescript/native-preview`. `--incremental`, `--build` and `--watch` are marked done (https://github.com/microsoft/typescript-go). | repo README | 0.95 s (`tsc`) down to 0.17 s |
| eslint | `--cache` "does not track dependencies between files... type-aware rules... does not report that problem until the importing file or the configuration changes" (https://eslint.org/docs/latest/use/command-line-interface). | ESLint docs | 2.14 s down to 1.09 s, but stale results for typed rules |

- **How to apply it without breaking user scripts**: RIFT runs the user's scripts (`session/verify.ts:124-127`),
  so it may only add flags when the script body is a bare invocation of a known tool. For example,
  `"test": "bun test"` becomes `bun test --changed`. `"typecheck": "tsc --noEmit"` becomes
  `tsc --noEmit --incremental --tsBuildInfoFile <state>/<hash>.tsbuildinfo`. For a script like
  `"test": "bun test --timeout 30000 --max-concurrency=4 --only-failures"`, adding flags is still safe
  for bun. Anything with `&&`, a wrapper or env-setting runs unscoped. Use typed ESLint `--cache` only
  when the config has no type-aware rules. Otherwise lint the edited files only, which measured 1.07 s
  and still sees cross-file types in their own diagnostics.
- **Monorepo scoping**: today the nearest package with scripts wins (`session/verify.ts:168-199`). Add the
  workspace *dependents*: packages whose `package.json` depends on the edited package. Run their
  typecheck at least. This fixes the `packages/core` gap in the summary.
- **Backstop**: run the full, unscoped suite when the user is idle or at session end, and on every
  `rift run`. Also run it whenever the edit touches config files (`package.json`, `tsconfig*.json`,
  lockfiles, `vitest.config.*`, `conftest.py`), because import-graph scoping cannot see those.
- **Gain**: scratch project 7.0 s down to 0.18 s for parallel and scoped together (`tsgo`, `oxlint`
  and scoped `bun test`). RIFT package 262 s down to about 8.5 s for tests.
- **Catch**: slightly worse per turn for dynamic imports and config-driven tests. It becomes the same
  overall once the backstop runs, and better in practice, because a 262 s suite with a 10-minute timeout
  often finishes after the user has moved on.
- **Risk**: medium. Getting script parsing wrong means running an unscoped check, which is safe but
  slow. **Effort**: M.

#### 9. Reuse the agent's own runs, but only where the exit code is real
- **What**: walk the turn's `bash` tool parts (`p.state.input.command`, `p.state.metadata.exit` from
  `tool/shell.ts:586-590`, `time.end`). A check is reusable when all of these hold: the normalized
  command equals the resolved check, the cwd matches, `exit === 0`, `truncated` is false, it was not
  killed (`<shell_metadata>`), and the tree hash at that step equals the tree hash at the end of the
  turn (idea 2).
- **The catch found in practice**: both agents ran `bun test test/m140.test.ts 2>&1 | tail -20` and
  `npm run typecheck 2>&1 | tail -20 && ...`. A pipeline's exit status is `tail`'s, so `exit=0` proves
  nothing. The prototype (`claims_pre.py`) flagged all three runs as "piped, exit code unverifiable".
  Reuse is therefore safe only for unpiped commands, or if the shell tool runs under `set -o pipefail`.
  That would be a behavior change for every bash call.
- **Gain**: small in practice, given the piping. Ideas 5 and 7 (stop the agent duplicating, give it a
  `verify` tool) get the same saving more reliably.
- **Catch**: same when done right, worse if piping is mishandled. **Risk**: medium. **Effort**: S to M.
  Rank it below 5 and 7.

#### 10. Separate new failures from failures that were already there
- **What**: on a cache miss for the session's *baseline* tree, the tree at the first user message of
  the session (`verifyBaseline` is captured at `prompt.ts:1574`), run the checks once in the background
  and cache them. Then report each failure as "new in this session" or "already failing before you
  started". For test runners, compare failing test names (bun prints `(fail) <name>`). For other checks,
  compare exit status and the set of error locations.
- **Gain**: none in speed, unless you count the confusion avoided. With the cache from idea 2 it costs
  one extra run per session.
- **Catch**: better. Today RIFT's own 6 pre-existing failures turn every report red, and a warning that
  is always on gets ignored. The "Do not treat this task as done" line (`session/verify.ts:541`) should
  appear only for new failures.
- **Risk**: low. **Effort**: M.

### Tier 3: cheaper second passes

#### 11. Claims check: deterministic first, model second
- **Deterministic pre-check** (prototype in `claims_pre.py`, 0.05 to 0.8 ms):
  1. Every file path the summary names was edited this turn.
  2. Every `function|class|const|interface|type <name>` in backticks appears on an added diff line.
  3. Every check command the summary says it ran has a matching `bash` call that exited 0 and was not
     piped.

  On a fabricated summary ("also updated `src/m141.ts`, added `mul`, `npm run e2e` passes") it caught all
  three inventions. On the real summaries it found no false file or symbol claims. It correctly flagged
  the piped test runs as unverified.
- Rule 3 closes a real gap. The model prompt tells it to "Ignore claims about running commands, tests or
  tools, which are verified separately" (`prompt.ts:132`), but nothing verifies them separately. The
  checks verify the *code*, not the *claim*.
- **Then**: call the model only when the deterministic pass is clean *and* the diff is non-trivial, for
  example more than about 40 changed lines or more than 2 files. Cap the diff at about 20 KB, as the
  prior report suggested. `session/verify.ts:299` uses 100 KB.
- **Report errors honestly**: a provider error currently becomes `""`, then `parseClaims` returns
  undefined, and the report says "unreadable verdict" (`prompt.ts:1369-1374`). Report
  "claims model error: <message>" instead.
- **Free model**: on `opencode/big-pickle` the claims call (and the title call) fail with "free tier can
  only be used from within OpenCode", while the main turns succeed. So for free-tier users the claims
  check never works. Fall back to the deterministic pass and say so.
- **Gain**: 3 to 6 s of model time per turn (prior report) is skipped on small diffs. There are fewer
  rate-limit hits for the next turn.
- **Catch**: better. Command claims are checked for the first time, and the deterministic rules cannot
  hallucinate agreement. **Risk**: low. **Effort**: S.

#### 12. Graph evidence: pay for it only when it is new
- **Cost**: the `graphwrite` nudge (`session/system.ts:57`) is sent on *every* turn. Both runs of a
  one-function task made `graphwrite`-only model steps: 2 steps, 11.0 s, 1074 output tokens in fg1, and
  1 step, 3.5 s in fg2. Every call re-sends the whole graph ("Each call replaces the whole graph",
  `tool/graph.txt`).
- **Every turn re-runs the evidence for every node in the session** (`Evidence.plan(graph.get(sessionID))`,
  `prompt.ts:1419`), including nodes the turn did not touch.
- **Fixes**:
  - (a) Send the nudge only when the user prompt or the plan looks multi-step, or after N edits.
    Otherwise omit it.
  - (b) Run evidence only for nodes whose `files` intersect this turn's edited paths, or whose evidence
    has no cache hit for the current tree (idea 2).
  - (c) Dedupe evidence commands against the checks. They are the same command in 2 of 2 runs.
  - (d) "Implementation: N files present" is free, so keep it.
- **Gain**: 3.5 to 11 s of agent time per small turn, and 1 to 3.7 s of evidence time.
- **Catch**: same for small tasks. The graph still exists for large ones. **Risk**: low.
  **Effort**: S for (b), (c) and (d). S to M for (a).

#### 13. Cancel or supersede stale verification, and give it low priority
- Verification is forked into the service-layer scope (`prompt.ts:214`, `2162`). It is not tied to the
  session runner (`session/run-state.ts:77-93`), so a new prompt or a session cancel does not stop it.
  Keep one fiber per session in a `FiberMap` keyed by `sessionID`. On a new prompt or a cancel,
  interrupt it. The `onInterrupt` path (`prompt.ts:1550-1556`) already writes "not run (cancelled)".
  Mark the report "superseded" rather than "cancelled". With idea 7 the run usually finishes first
  anyway. Use `nice` for spawned checks (`session/verify.ts:212`).
- Each check also asks the bash permission (`prompt.ts:1470-1486`). In interactive sessions where bash
  is set to `ask`, a background verification can pop permission prompts *after* the turn, and in
  `rift run` without `--auto` they are auto-rejected (`cli/cmd/run.ts:700-718`). Remember the approvals
  per session for the detected check commands.
- **Gain**: CPU for the next turn. **Catch**: same. **Risk**: low. **Effort**: S.

#### 14. Browser check
- **Measured** with the real `BrowserSession` on a static `file://` page: launch 0.10 s, first navigate
  0.08 s, later navigates 0.00 to 0.01 s, **close 0.41 s** (`browser/session.ts:240-247`: `killTree` plus
  removing the profile). `checkBrowser` took 0.59 to 0.91 s end to end. It is cheap. The expensive case
  is a dead dev server, which waits up to the 30 s load timeout (`session/verify.ts:440`).
- **Speed**: close in the background (don't `await` it in `finally`, `session/verify.ts:468`). Reuse one
  session for the browser check and all browser and screenshot evidence in a turn. Today each one
  launches its own (`session/evidence.ts:149-181`). For `http://localhost` URLs, do a 1 s `fetch`
  first, and report "server not running" instead of waiting 30 s.
- **Gate it**: with `verify_browser_url` set, it runs on every editing turn, even for backend-only edits
  (`prompt.ts:1504-1506`). Run it only when the edited files include UI files (`.html`, `.css`, `.tsx`,
  `.jsx`, `.vue`, `.svelte`, `.astro`, or files under `public/`, `app/`, `pages/` or `components/`).
- **Catch (improvement)**: `navigate` reads the console right after `Page.loadEventFired`
  (`browser/session.ts:169-178`). Errors thrown after load (hydration, effects, failed fetches) are
  missed. Add a settle window of about 500 to 1000 ms, or wait for network idle, before reading. That
  costs under 1 s and catches the most common "renders blank" bug.
- **Effort**: S.

#### 15. LSP diagnostics are not a typecheck replacement today
- LSP is off by default: `if (!cfg.lsp)` logs "all LSPs are disabled" (`lsp/lsp.ts:151-152`), and the
  config doc says "Omit or set to false to disable" (`packages/core/src/v1/config/config.ts:174-176`).
- When LSP is on, `edit` reports diagnostics for the edited file only (`tool/edit.ts:197-201`), while
  `write` also reports other files (`tool/write.ts:76-90`). An edit that breaks a caller in another
  file is invisible to the edit tool.
- **Use**: when LSP is enabled, request `"full"` diagnostics once at the end of the turn
  (`lsp.touchFile(file, "full")`, `lsp/lsp.ts:344-356`) as a fast pre-check that can fail early. Keep
  the real typecheck as the authority.
- **Gain**: small. **Effort**: S to M. Low priority.

#### 16. Warm daemons (`tsc --watch`, the vitest watch API, persistent test workers)
- `tsgo` plus an incremental build-info file already gets warm typecheck to 0.17 s (scratch) and
  0.9 to 2.5 s (RIFT). A daemon would save little more, but it adds process lifecycle, memory and
  staleness problems.
- Vitest's `--standalone` and watch mode exist (https://vitest.dev/guide/cli), but they are tied to a
  TTY or long-lived process.
- **Recommendation**: do not build this. Ideas 2, 7 and 8 get most of the benefit. **Effort**: L.

#### 17. Smarter timeouts
- 10 minutes per check (`prompt.ts:1445`) is too long for the common case. Use a timeout of
  `max(60 s, 3 × last duration of this check in this project)`, stored with the cache entry. Keep the
  config override.
- **Gain**: bounds runaway checks. **Catch**: same. A timeout is already reported as a failure.
  **Effort**: S.

## Target design: verification v2

```
edit tool completes ──► debounce 1.5 s ──► plan(changed files)
                                             │ classify: docs-only? → skip (keep scope warning)
                                             │ resolve: owning package + workspace dependents
                                             │ scope: bun --changed / vitest related / jest --findRelatedTests
                                             │        tsc|tsgo --incremental (state dir), lint edited files
                                             ▼
                          cache lookup (command, cwd, tree hash) ──hit──► result
                                             │ miss
                                             ▼
               run in parallel (read-only classes), nice, adaptive timeout
               cancel + restart on next edit; one fiber per session
                                             │
agent may call `verify` tool ◄───────────────┤  (returns in-flight or cached result)
                                             ▼
turn ends ──► join in-flight run (re-run if tree hash changed)
          ──► dedupe evidence against checks; evidence only for touched nodes
          ──► claims: deterministic pass; model only if clean and diff is non-trivial
          ──► browser only if UI files changed (reused session, settle window)
          ──► report: new failures vs already failing (baseline cache)
          ──► next prompt: inject failures as a synthetic reminder
idle / session end / `rift run` ──► full unscoped backstop run (cached by tree hash)
```

What it keeps: the real exit code is still the authority, unscoped coverage still runs (it moves to the
backstop), and a check that did not run is still never reported as passed. What it adds: claims about
commands are checked, failures are labelled new or already failing, failures are fixed in the same
turn, and `rift run` gets verification.

### Build order

1. **Correctness, all S**: idea 1 (`rift run` foreground and printing the report), idea 6 (next-turn
   reminder and the stale task-state fix), idea 11's error reporting ("claims model error" instead of
   "unreadable verdict").
2. **Remove repeat work, S**: idea 2 (tree-hash cache and evidence dedupe), idea 12 (b) and (c) (evidence
   only for touched nodes), idea 3 (docs-only skip and the root-fallback fix).
3. **Parallel, S**: idea 4 for the known read-only classes, with `nice` and a cap (idea 13).
4. **Prompt changes, S**: idea 5 (the rift.txt line) and idea 12 (a) (when to send the graph nudge).
   Do this *after* step 6 if you want the agent to keep feedback during the turn. Otherwise ship it with
   the reminder from step 1.
5. **Cheaper claims, S**: idea 11's deterministic pass and small-diff skip.
6. **Speculative in-turn verification, M**: idea 7, with the `verify` tool.
7. **Scoping, M**: idea 8 (script parsing, `--changed`/`related`, `--incremental` build info, workspace
   dependents, backstop run).
8. **Value, M**: idea 10 (baseline failures).
9. **Polish, S**: idea 14 (browser), idea 17 (timeouts), idea 13 (cancellation), idea 15 (LSP
   pre-check).

Expected result on the measured task: RIFT's own checks take about 0.2 s (scoped, parallel, warm) and
start before the turn ends. There are no duplicate evidence runs. The agent loop loses one self-check
step (7 to 10 s) and the `graphwrite` steps (3.5 to 11 s). That puts the turn at roughly 25 to 30 s
instead of 37 to 49 s of agent time, with a report that is complete when the reply ends.

## Measurements

Machine: macOS (Darwin 27), bun 1.4.3, node 24.18. The load average was 6 to 10 during parts of the
session because of other apps. The RIFT typecheck numbers vary widely for that reason; the scratch-project
numbers were stable (min and max within 5%).

### Microbenchmarks: 150-module TS project, 2100 bun tests, typed ESLint

Each case was run 3 times after appending one line to `src/m140.ts` (`bench.py`). Medians:

| Case | Median |
|---|---|
| typecheck: `tsc --noEmit` (cold) | 0.95 s |
| typecheck: `tsc --incremental`, warm, 1 file edited | 0.63 s |
| typecheck: `tsgo --noEmit` | 0.17 s |
| lint: `eslint src` (type-aware, no cache) | 2.14 s |
| lint: `eslint --cache`, warm, 1 file edited | 1.09 s |
| lint: `eslint` on the edited file only | 1.07 s |
| lint: `oxlint src` | 0.08 s |
| test: `bun test`, all 150 files | 3.75 s |
| test: `bun test` scoped (edited module plus dependents, 1 file) | 0.05 s |
| test: `bun test --changed` | 0.10 s |
| test: `bun test --parallel` | 0.54-0.64 s |
| test: `vitest run`, all | 7.95 s |
| test: `vitest related --run` | 0.98 s |
| **today**: `bun run typecheck; bun run lint; bun run test` (sequential) | **6.98 s** |
| the same three in parallel | 3.50 s |
| `tsgo`, `oxlint` and scoped `bun test` in parallel | **0.18 s** |
| sequential re-run with no change since the last run (cache would skip) | 6.81 s |

### RIFT's own package (`opencode/packages/opencode`)

- `bun run typecheck` (`tsgo --noEmit`): 12.2 s and 9.9 s under light load, 67.9 s under heavy load.
- `tsgo --noEmit --incremental --tsBuildInfoFile <scratch>`: 29 to 93 s cold, then 0.9 to 2.5 s on a
  warm re-run with no change. This is a lower bound. A one-file edit would sit between the two.
- `bun run test`: 262.4 s, 3195 tests in 216 files, 6 failures that existed before any edit
  (`opencode loader keeps paid models...` x2, `v2 pty HttpApi > applies plugin shell environment...`,
  `createTuiAttention` x3).
- `bun test test/session/verify.test.ts` (the file covering `session/verify.ts`): 8.5 s.
- `Verify.resolve` for `docs/research/rift-speed.md`: `go vet ./...` and `go test ./...` at the root.
  They ran in 10.0 s and 5.3 s.
- `git status` fails in this checkout ("not a git repository: .../worktrees/RIFT-Code-debloat"). As a
  result, `Verify.changedFiles` returns `[]` (the scope warning is silently off), and `turnDiff` falls
  back to sending whole file contents to the claims model. This is specific to this environment, but it
  is worth handling explicitly.

### Browser check (`Verify.checkBrowser`, static `file://` page)

0.91 s, 0.60 s and 0.59 s. Split: launch 0.10 s, navigate 0.08 s then 0.01 s, close 0.41 s.

### End to end (`rift` from source, `opencode/big-pickle`, `verify_background: false`)

Per-step times and tool calls are in the tables in the executive summary. Wall time was 46.6 s (fg1)
and 52.7 s (fg2), and verification took 8.1 s and 11.1 s of that. The claims call failed on the free
tier in both runs.

### How to rerun

The scripts are in `/private/tmp/claude-501/-Users-shiv-Developer-RIFT-Code/adcdaf8a-14b0-47ba-be36-1062be8e02fc/scratchpad/vs/`:

```sh
V=/private/tmp/claude-501/-Users-shiv-Developer-RIFT-Code/adcdaf8a-14b0-47ba-be36-1062be8e02fc/scratchpad/vs
# 1. project (already generated in $V/proj; to regenerate in a new dir, copy package.json/tsconfig/eslint/vitest configs first)
python3 -I $V/gen.py <dir> 150 && (cd <dir> && bun install)
# 2. microbenchmarks (edits src/m140.ts between reps, restores it after)
python3 -I $V/bench.py $V/proj 3
# 3. end to end, foreground verification so it can be timed; logs in $V/<label>.log
$V/e2e.sh fg3                      # optional 2nd arg: config JSON, default {"verify_background":false}
cd opencode/packages/opencode && env -u OPENCODE_API_KEY bun run src/index.ts export <ses_id> > $V/fg3.json
# 4. deterministic claims pre-check on an exported session
python3 -I $V/claims_pre.py $V/fg3.json $V/e2e-fg3
# 5. browser timing, and what Verify.resolve picks for given files (run from packages/opencode)
bun run $V/browser-bench.ts $V/site/index.html
bun run $V/browser-split.ts $V/site/index.html
bun run $V/resolve.ts
```

Raw outputs: `bench1.txt`, `rift-fulltest.txt`, `fg1.log` and `fg1.json`, `fg2.log` and `fg2.json`, all
in the same directory.
