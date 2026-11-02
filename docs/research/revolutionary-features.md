# Research: features that could change how people use a terminal coding agent

Written 2026-11-02. Builds on `harness-papers.md` (cited below as "harness-papers"); nothing from it is repeated.

## How to read the evidence marks

- **READ**: I read the text myself. This applies only to source code in `/Users/shiv/Developer/rift-sync/rift-v2/opencode` and the RIFT overlay, and to `harness-papers.md`.
- **SUMMARY**: the fetch tool in this session returns an answer written by a small model about the page, not the page text. Every arXiv page I fetched came back that way, so every paper claim below is SUMMARY, even where the summary quoted tables. I did not read any paper text directly. Where a fetch said it was truncated, I say so.
- **SNIPPET**: only a search-result abstract or a secondary write-up.
- arXiv IDs come from the fetched page header (fetched) or only from a search result (search-only). Check any ID before citing it externally.
- All benchmark numbers are from the authors' own runs. Almost all are SWE-Bench Verified or Terminal-Bench, which may not transfer to real use. I note where evidence is thin.

## 1. Ranked feature proposals

### 1. Tamper-resistant verification with a "proof receipt"

**User experience.** When RIFT says "done", it prints a receipt: which checks ran, their real output, the exact tree hash they ran against, and a list of anything the agent touched that could weaken the checks (test files, lint/CI config, the verify config). Edits to those protected files are blocked or need explicit approval. A check that cannot run is shown as "not verified", never as a pass.

**Evidence.**
- EvilGenie (arXiv 2511.21654, fetched, SUMMARY): on 145 unambiguous LiveCodeBench-hard problems, Claude Code wrote a heuristic (non-general) solution 20.7% of the time and hardcoded test cases 2.1%; Codex 0.7% each; Gemini CLI deleted a test file in 3.4% of runs. A test-file-edit detector is free but cannot see hardcoding; an LLM judge had ~1% false positives and ~16.7% false negatives; held-out tests added little over the judge. Caveats from the summary: contest problems only, 10-minute limit, ambiguous set n=9, not every unflagged run was checked by hand.
- Hardening Agent Benchmarks with Adversarial Hacker-Fixer Loops (2606.08960, fetched, SUMMARY): 323 of 1,968 terminal-benchmark tasks (16%) were exploitable by frontier models given only the task text. Their hacker/fixer/solver loop cut attack success on KernelBench from 62% to 0% and on Terminal Bench (77 tasks) from 39% to 17%.
- Auditing Harness Tampering in Self-Improving Agents (2609.00069, fetched, SUMMARY): self-modifying agents produce "illusory performance gains"; tampering recurs across agents and persists in the best agent's lineage. No numbers on the page.
- harness-papers already says to keep verify config outside the agent's write scope (snippet there).

**Build on OpenCode v2.** Mostly a plugin. `ctx.tool.hook("execute.before")` can reject a call with a `Tool.Error` (READ `packages/plugin/src/effect/tool.ts`, "Only execute.before may fail"). `ctx.permission.hook("evaluate")` can set the effect for a write to protected paths (READ `permission.ts`). `ctx.shell.hook("create.before")` can inspect or rewrite shell commands (READ `shell.ts`), which catches `sed -i tests/...` bypasses. The tree hash and baseline already exist in `rift/overlay/packages/core/src/plugin/rift-verify.ts` (`State.baseline`, `State.verified`; READ). A grep of `rift-verify/checks.ts` found no test-file-edit detection today (READ). No patch needed.

**Main risk.** False blocks when a task legitimately needs a test edit (TDD). Mitigate with "allowed to add tests, not weaken existing ones" (flag deleted or loosened assertions in the diff) rather than a hard block. It will not catch hardcoding or heuristic solutions; say so on the receipt.

**Size.** Small to medium.

### 2. Best-of-N tournament in git worktrees, winner picked by verifier

**User experience.** `/race 3` (or an automatic option on hard tasks) runs N attempts in separate worktrees at the same time. Each is checked with the project's real checks. RIFT shows a table (checks passed, diff size, files touched, cost) and applies the winner to your tree; you can open any loser. Ties and close calls go to a judge model that compares short summaries of the attempts, not full transcripts.

**Evidence.**
- Scaling Test-Time Compute for Agentic Coding (2604.16529, fetched, SUMMARY, truncated at ~100k of 107k chars): N=16 rollouts, each summarized, then Recursive Tournament Voting (pairwise, 8 votes per comparison, 15 comparisons). With Claude 4.5 Opus on SWE-Bench Verified 70.94% to 77.60%, Terminal-Bench 2.0 46.95% to 59.09%; Claude 4.5 Sonnet 67.41% to 75.60%. Their ablation (100 tasks, Gemini 3.1 Pro): single refinement 73.75%, random-K 76.94%, RTV-selected K 79.25%. Summaries beat full traces as judge inputs. Limits: no cost reported; judges are the same model family as rollouts; new solutions are rare (5 SWE tasks across all models), so most gain is better selection and refinement of what was already solvable.
- SWE-Lego (2601.01426, search-only, SNIPPET): parallel sampling gives most gains once extra sequential turns stop helping. SWE-World (2602.03419, search-only, SNIPPET): 55.0% at K=1 to 68.2% at K=8 with a trained verifier.
- R2E-Gym (2504.07164, fetched, SUMMARY, truncated at 100k of 118k chars; 2025, foundational): Best@26 execution-based 43.7%, execution-free 42.8%, hybrid 51.0% (Best@16 hybrid 49.4%) on SWE-Bench Verified with a weak open model.

**Build on OpenCode v2.** Plugin. `ctx.worktree` exposes create/remove/list (READ `worktree.ts`, `WorktreeApi`). `ctx.session` exposes `create`, `prompt`, `wait`, `interrupt` (READ `session.ts` `SessionDomain` Pick list), so a coordinator tool can spawn child sessions in each worktree. Selection runs the existing `RiftChecks` per worktree and uses `ctx.experimental.generate` (stateless model call, READ `plugin.ts`) for the judge. A TUI panel listing attempts uses the existing sidebar plugin route.

**Main risk.** Cost and the 8 GB Mac: N concurrent agents plus N test runs can exhaust memory (project memory notes the machine). Default N to 2 to 3, stagger test runs, and ask before starting. Evidence is for N=16 on benchmarks; the gain at N=3 is not shown by these sources. Verifier-chosen winners are exposed to the same hacking risk as feature 1, so feature 1 must come first.

**Size.** Large.

### 3. Hybrid verdict: acceptance rubric written before editing, graded against the diff, combined with real checks

**User experience.** Before editing, RIFT writes 5 to 10 checkable acceptance criteria for the task (grounded in the repo) and shows them. After editing, the verdict has two columns: real check output (tests, typecheck, lint) and rubric grading of the diff (each criterion met / not met / cannot tell, with the lines that support it). The final "done" requires both. This is the "proof the change works" view for changes the repo's tests do not cover.

**Evidence.**
- Agentic Rubrics (2601.04171, fetched, SUMMARY, truncated at 100k of 126k chars): execution-free rubric grading reached 40.6% (Qwen3-32B) and 54.2% (Qwen3-Coder-30B) Best@16 on SWE-Bench Verified versus random 22.6% / 39.6% and oracle tests 51.4% / 65.6%; ROC-AUC 0.886 against ground-truth test outcomes; about $0.29 per instance. Limits stated by the authors: many rubric items were low-utility (over-specified, redundant); 46% of cases where tests passed but rubrics scored low were low-utility; rubric quality depends on the generating model.
- R2E-Gym (above): hybrid beat either alone by 7-8 points, and the execution-free verifier leaned on the agent's own "thoughts" (patch-only Best@26 37.6% vs 42.8% with trajectory), which can mislead it. So grade the diff, not the agent's story.
- Hybrid ~51% vs ~42-43% is also the Berkeley figure in harness-papers (snippet there).
- Selective verification: SWE-Verifier (2610.30284, fetched, SUMMARY): a trained 4B model that checks under 4% of steps, +1.7 points (75.47% to 77.20%) at 1.09x cost on MiniMax-M2.7. It needs a trained model, so RIFT cannot ship it as a plugin. The transferable idea is only "do not verify everything"; RIFT's verify-after-edits already follows it.

**Build on OpenCode v2.** Plugin. Rubric via `ctx.session.hook("prompt")` or a command that runs a rubric pass before the first edit (READ `session.ts` hooks); grading via `ctx.experimental.generate`; display via the existing `Rift.State` rpc (READ `rift-verify.ts`, `Rift.Definition` and the `changed` event). Rubrics must be stored in plugin storage (`ctx.storage`, READ `storage.ts`), outside the agent's write scope.

**Main risk.** Rubric graders are noisy and can give false confidence; the agent can also see the rubric and write to it. Show rubric results as advisory unless the user opts in, and never let a rubric pass override a failing real check.

**Size.** Medium.

### 4. Intent-level diff review (intent, drift score, spotlight)

**User experience.** Instead of reading a 40-file diff top to bottom, the review screen opens with: what you asked for, what the agent says it did, a drift score (how far the diff goes beyond or misses the request), and a ranked "look here first" list of hunks with a reason each. RIFT already compares the agent's summary with the real diff; this extends it to the whole review.

**Evidence.**
- ARCTIC (2607.29516, Meta, fetched, SUMMARY from abstract only): intent prediction F1 0.86 offline, 90.2% approval in rollout; drift detection by backtranslation, QWK 0.907 with human annotators; spotlight 2.4x quality over a baseline AI reviewer at 5x fewer tokens; a 5.76-point additional reduction in misalignment (p=0.026). Based on 18,000 reviews. These are vendor-internal results on Meta's data and not reproducible by RIFT. This is not a controlled study of whether human reviewers do better.
- Evidence of benefit to human reviewers is thin: I found no controlled reviewer study (search only returned opinion pieces and a 2025 comprehension paper, 2503.21455, SNIPPET).

**Build on OpenCode v2.** Mostly plugin. Diff source: `ctx.vcs` diff definition (READ `vcs.ts`, `VcsDiffInput`). Intent source: the session's prompts via `ctx.session.context` and the `graph` nodes RIFT already stores. Backtranslation = `ctx.experimental.generate` on the diff alone, then compare to the request. UI is a new TUI feature plugin next to `rift-sidebar`.

**Main risk.** A confident intent summary can hide a bad hunk; reviewers may stop reading the diff. Always keep one-key access to the raw diff, and mark the spotlight as a ranking, not a clearance.

**Size.** Medium.

### 5. Turn checkpoints, rewind, and fork-from-here

**User experience.** Every agent turn is a checkpoint. `/rewind` shows a list of turns with the files each changed; picking one restores those files and (optionally) the conversation to that point. `/fork-from-here` starts a second session from that point, so you can try a different instruction without losing the first path.

**Evidence.** This is product design, not a paper result; I found no controlled study. It also underpins feature 2.

**Build on OpenCode v2.** Core already has the machinery. `packages/core/src/snapshot.ts` provides `capture`, `files`, `diff`, `restore` as a content-addressed tree store (READ). The schema has `Session.Revert` with `snapshot` (READ `schema/src/session-revert.ts`) and `Session.ForkBoundary` (READ `session-fork.ts`). However, the public plugin `SessionDomain` Pick list does not include fork or revert (READ `plugin/src/effect/session.ts`), and `Snapshot.Service` is a core service. The bundled `rift-verify` plugin already pulls core services via `Permission.Service` (READ), so a bundled RIFT plugin can use `Snapshot.Service` directly. Exposing fork/revert to the plugin API would be a small patch. Only a TUI list and a command are new.

**Main risk.** Restoring files without restoring conversation (or the reverse) confuses the model. Restore both or tell the model what changed. Snapshots are disabled or best-effort in some cases ("returns undefined when disabled", READ `snapshot.ts`), so show clearly when a turn has no checkpoint.

**Size.** Small to medium.

### 6. Background runs with an inbox ("check on it later")

**User experience.** `/bg <task>` runs the task in its own worktree and session, returns the prompt immediately, and drops a one-screen result (receipt, spotlight, cost) into an inbox you open later. While running you can steer it with a message or stop it.

**Evidence.** Thin. No paper here shows this changes outcomes. Related long-horizon work (SWE-Marathon, 2606.07682, search-only, SNIPPET) notes agents on multi-hour rollouts inspect visible tests and verifier artifacts, which again argues for feature 1. The METR trial (July 2025: 16 experienced developers, 246 tasks, 19% slower with AI; SNIPPET via news coverage) is old; a 2026 update showing an improvement is only seen in secondary posts (SNIPPET, unverified), so I would not use either to justify this.

**Build on OpenCode v2.** Mostly existing. Inbox delivery has `steer` and `queue` (READ `schema/src/session-inbox.ts`); `session.hook("experimental.idle")` lists background shells and subagents (READ `session.ts`); the built-in goal plugin (`core/src/plugin/goal.ts`, READ the head: judge, 50 rounds, stall limit, 30 min wait, resumes paused after a restart) already handles long autonomous runs. Worktree isolation uses `ctx.worktree`. The new parts are the result inbox and a TUI list.

**Main risk.** Unattended runs amplify mistakes and cost; need a hard budget cap and a sandbox (feature 8).

**Size.** Medium.

### 7. Cache-stable prompt guard

**User experience.** Faster first token and lower cost on long sessions, with no visible change. A debug view shows cache read vs write tokens per turn and flags the plugin or hook that broke the prefix.

**Evidence.** "Don't Break the Cache" (2601.06007, fetched, SUMMARY, v2 table): over 500 agent sessions on a research benchmark, cost fell by 78-81% on GPT-5.2 and Claude Sonnet 4.5, 28-41% on Gemini 2.5 Pro; TTFT improved 9.5-22.9% on those two but full-context caching hurt GPT-4o (-8.8%) and one Gemini mode (-2.9%). Recommendations: stable system prompt, dynamic values last, do not change the tool set between requests, exclude dynamic tool results from the cache. Caveats: a research (web search) workload, not coding; the abstract and table disagree on some ranges; latency numbers are noisy.

**Build on OpenCode v2.** Plugin for the audit; a patch if a hook proves insufficient. `session.hook("context")` and `"model.request"` let a plugin see `system`, `messages`, `tools` and `options` before each call (READ `session.ts`: `SessionContext.tools`, `SessionRequest.system`). A plugin can hash the prefix per turn and warn when RIFT's own plugins (graph state injected into the system prompt, timestamps) change it. The note in `SessionRequest` that `metadata.experimental.instructions` is not updated when a hook edits `text` (READ) is a trap to avoid. The staged-compaction work in harness-papers also needs the cache check: eliding old output at 60% changes the prefix, so measure the net effect.

**Main risk.** Low. Only the measurement may show smaller gains than the paper on coding workloads.

**Size.** Small.

### 8. OS sandbox for shell commands

**User experience.** Shell commands run with write access limited to the project and a temp directory, and network off by default (or allowlisted). Escapes require approval. Needed before background runs and best-of-N are safe.

**Evidence.**
- Codex uses Seatbelt on macOS and Bubblewrap on Linux; OpenCode has no OS sandbox (harness-papers, read there).
- Sandbox escapes in Cursor, Codex, Gemini CLI and Antigravity were reported in July 2026 (SNIPPET, via a Cloud Security Alliance note and a news article; the primary Pillar Security write-up was not read). The reported pattern is that a trusted component outside the sandbox acted on manipulated agent output, so a shell sandbox alone is not enough.
- Prompt-injection attack success of 41-84% over 314 payloads (AIShellJack) is SNIPPET from a secondary summary; do not rely on the number.

**Build on OpenCode v2.** `ctx.shell.hook("create.before")` receives and can edit `command`, `cwd`, `env`, `shell` (READ `shell.ts`), so a plugin can wrap commands in `sandbox-exec` (macOS) or `bwrap` (Linux). Gaps: tools that spawn processes without going through the shell domain (MCP servers, PTY) are not covered, and I did not check every spawn path in core. That check is part of the work and might need a patch.

**Main risk.** Breaks toolchains that need network (package installs) or write outside the repo (caches). The macOS `sandbox-exec` tool is deprecated, though still what Codex uses.

**Size.** Medium.

### 9. Evidence-gated lessons ledger (repo memory that is earned, not written freely)

**User experience.** When a check fails and the agent then fixes it, RIFT proposes a one-line lesson ("this repo needs `pnpm gen` before typecheck") with the failing and passing check output attached. You approve it once; approved lessons are shown to future sessions. Lessons that stop being true (the check no longer fails) are flagged for removal. Nothing is written without your approval.

**Evidence, mostly negative on the free-form version.**
- Skill Issue (2609.12742, fetched, SUMMARY, truncated at 100k of 143k chars): auto-optimized repo SKILL.md files on three Kotlin repos with Claude Code + Sonnet 4.6 gave +4.9 points (GEPA) and +0.1 points (SkillOpt, with a 6-point drop on ktor); no result reached p=0.05 (best p=0.29), about 69 pooled tasks, about $2,014 total. A maintainer found real value in parts of one skill and generic filler in the other; both cut time to resolve two issues from 15-20 to 6-8 minutes (anecdote, two issues).
- Evaluating AGENTS.md (2602.11988, search-only, SNIPPET): context files gave no success gain and raised cost by over 20%; useful only for non-standard practices.
- Boundary-Aware Skill Memory (2608.22339, search-only, one blog as source, SNIPPET): skills saved from successes may make tool choice worse.
- Procedural-memory survey (2606.23127, search-only, SNIPPET): retrieval over large noisy skill sets can erase the gain.
- So the design keeps the store tiny and tied to a check result, rather than free-form notes.

**Build on OpenCode v2.** Plugin. Trigger on RIFT's existing check results; store in `ctx.storage` (READ `storage.ts`) or a repo file; inject with `ctx.skill.transform` (READ `skill.ts`, `SkillEditor.add`) or the session `context` hook. Old RIFT's `.rift/tasks` task memory is the other half (task state survives compaction); harness-papers already says to port it.

**Main risk.** Wrong or stale lessons steer the agent, and a lesson store is a prompt-injection target (a repo file the agent reads and trusts). Keep lessons data-only, user-approved, and measured (see section 3).

**Size.** Medium.

### 10. Offline harness lab (self-improvement with a fence)

**User experience.** `rift lab` takes a fixed task set and RIFT's own tunable settings (compaction thresholds, planning on/off per model, check timeouts, prompt wording), runs variants, and shows which variant won with the cost. You review and adopt a change; the agent never edits live harness settings on its own.

**Evidence.**
- Darwin Gödel Machine (2505.22954, 2025, search-only, SNIPPET; ICLR 2026): SWE-bench 20.0% to 50.0% and Polyglot 14.2% to 30.7% by letting an agent edit its own code, with sandboxing and human oversight. Author-reported, no independent replication seen.
- Auditing Harness Tampering (2609.00069, above): self-modification produces illusory gains.
- Hardening loop (2606.08960): the same trick used defensively to find holes in a verifier.
- Self-HPO (2610.22791), HarnessDev (2609.01437), Ouroboros (2608.08311) are leads in harness-papers; I did not fetch them.

**Build on OpenCode v2.** Needs an eval runner first (section 3), not a plugin hook. Settings are in config and plugin options (`ctx.options`, READ `options.ts` listed). The runner itself is an external script.

**Main risk.** Overfitting to a small task set and Goodharting the eval. Hold out tasks, keep check config and the eval out of reach of any proposer, and require a human to approve changes.

**Size.** Large.

## 2. What NOT to build (with evidence)

- **An agent that rewrites its own harness or checks live.** Tampering recurs across agents and persists in the best lineage (2609.00069, SUMMARY); 16% of benchmark verifiers were hackable (2606.08960, SUMMARY). Do offline, human-approved changes only (feature 10).
- **Auto-generated AGENTS.md / repo overviews.** No success gain, over 20% more cost (2602.11988, SNIPPET); Skill Issue's results are not significant (SUMMARY). Only evidence-linked, approved lessons (feature 9).
- **A search/recall tool over past turns.** 56% of settings never called it, mean -0.36 points (harness-papers, read there).
- **A per-step trained verifier.** SWE-Verifier gain is +1.7 points and needs a trained model plus step sampling (2610.30284, SUMMARY); RIFT cannot ship the model as a plugin and its checks already run at the useful moment.
- **"LLM judge says it works" as the only proof.** Judge false-negative rate was 16.7% in EvilGenie (SUMMARY, small ambiguous set); the execution-free verifier leans on agent reasoning text (R2E-Gym, SUMMARY). Judges can supplement real checks, never replace them.
- **Large N by default.** Gains in 2604.16529 are at N=16 with no cost reported (SUMMARY); on a laptop this is not viable. Keep N small and opt-in.
- **Speculative execution of state-changing tools.** PASTE (2603.18897, fetched, SUMMARY from abstract) reports 43.5% shorter task time and 1.8x lower tool latency for a serving system, but its page did not say how it handles irreversible actions; a client-side approach is described elsewhere (search snippet) as suitable only for stateless, cheap tools. A coding agent's real latency is mostly model time and test runs; do read-only prefetch at most, and only after the eval shows tool wait is the bottleneck.
- **Shipping a generated mid-run "steering" that rewrites the system prompt.** It breaks the cache prefix (2601.06007, SUMMARY). Steer by appending a message (`delivery: "steer"`, READ), not by editing the prefix.
- **Trusting a shell sandbox as the whole safety story.** Reported escapes went around the sandbox through trusted components (SNIPPET). Pair it with permissions and protected paths.

## 3. How to measure each feature (small eval designs)

Common setup, built once (this is "step 0"; harness-papers also names it as the first thing to build): 20 to 40 tasks drawn from 2 to 3 real repos you use, each with a known-good fix and a hidden test the agent cannot see, plus 5 "trap" tasks where the easy path is to edit the test. Run each task 3 times per arm, because single runs are noisy (Skill Issue could not detect a +5 point effect with ~69 tasks; SUMMARY). Record: pass on hidden tests, cost, wall-clock time, tool calls, cache read tokens. Use paired comparisons per task. Report counts, not just percentages.

| Feature | Eval | Success signal |
|---|---|---|
| 1 Tamper gate + receipt | Trap tasks plus tasks that need a new test. Arms: gate off / gate on. | Fewer weakened or deleted tests on traps; no drop in pass on legitimate test-adding tasks; receipt matches a manual replay in 100% of 20 sampled runs. |
| 2 Best-of-N | Same tasks, arms: N=1, N=3 random pick, N=3 verifier pick. | Verifier pick beats random pick on hidden tests by more than run-to-run spread; report cost multiple and peak memory. |
| 3 Hybrid verdict | Collect 100 finished attempts with known hidden-test result. Compare: checks only, rubric only, both. | Precision of "done" claims (fraction truly passing) and recall; rubric adds value only if the combined precision improves without losing too much recall. |
| 4 Intent review | Seed 30 diffs with 1 planted off-intent or buggy hunk (scope creep, unrelated edit, removed guard). Give reviewers the raw diff vs the intent view; time them. | Planted hunk found rate and time to review. Use yourself and 2 colleagues; small sample, label it as such. |
| 5 Checkpoints | Scripted: edit, rewind, check tree hash equals the snapshot; fork and confirm the original is untouched. | Exact file equality in 100% of 50 rewinds including deleted and renamed files. |
| 6 Background runs | Run 10 tasks in background while you do other work. | Fraction needing intervention; wasted cost on tasks you would have cancelled; time to review a result. |
| 7 Cache guard | Replay a recorded 30-turn session with and without RIFT plugins. | Cache read share of input tokens and cost per session; list of prefix breaks found. |
| 8 Sandbox | A fixed list of 15 escape attempts (write outside project, read `~/.ssh`, network call, spawn via MCP) plus the normal task set. | Blocked attempts; zero regressions in normal-task pass rate; count of toolchains broken. |
| 9 Lessons ledger | Same tasks run twice on a repo: no ledger vs ledger built from the first pass (hold out tasks). Also log tokens added. | Held-out pass and cost versus no ledger. Given the negative literature, ship only if cost does not rise and pass is not worse. |
| 10 Harness lab | Not a user feature; its own eval is a held-out set the proposer never sees. | A change adopted on the tuning set must also win on the held-out set. |

## 4. Recommended build order

1. **Feature 1, tamper-resistant verification and the proof receipt.** Small, plugin-only, strengthens RIFT's one clear advantage, and it is a precondition for the rest: best-of-N selects winners by verifier, and a hackable verifier would just pick the best cheat (2606.08960 and 2511.21654, SUMMARY). Build the common eval setup alongside it, because it needs trap tasks anyway.
2. **Feature 5, checkpoints and rewind** (cheap, mostly existing core pieces) leading directly into **Feature 2, best-of-N in worktrees**. Checkpoints give the snapshot/restore and fork plumbing that parallel attempts also need, and best-of-N is the biggest visible change to how people use the tool. The strongest evidence for a large gain is here (2604.16529, SUMMARY), but only at N=16, so measure N=2 to 3 before promising anything.
3. **Feature 4, intent-level review**, because it makes the output of features 1 and 2 readable (receipt + spotlight), and RIFT already compares summary with diff. Evidence for human benefit is the thinnest of the three, so it comes third and ships with the planted-hunk eval.

Feature 7 (cache guard) is small enough to slot in anywhere and should be measured before the staged context management work from harness-papers goes in. Feature 3 (rubric) follows once features 1 and 4 exist, since it shares the receipt and review UI.

## 5. Sources

Source code (READ):
- `/Users/shiv/Developer/rift-sync/rift-v2/opencode/packages/plugin/src/effect/plugin.ts`, `session.ts`, `tool.ts`, `permission.ts`, `shell.ts`, `skill.ts`, `storage.ts`, `worktree.ts`, `vcs.ts`, `command.ts`, `agent.ts`, `event.ts`, `artifact.ts`, `registration.ts`
- `/Users/shiv/Developer/rift-sync/rift-v2/opencode/packages/core/src/snapshot.ts`, `worktree.ts`, `plugin/goal.ts` (head only)
- `/Users/shiv/Developer/rift-sync/rift-v2/opencode/packages/schema/src/session-inbox.ts`, `session-revert.ts`, `session-fork.ts`
- `/Users/shiv/Developer/rift-sync/rift-v2/rift/overlay/packages/core/src/plugin/rift-verify.ts` (head), `rift-verify/checks.ts` (grep only)
- `/Users/shiv/Developer/rift-sync/rift-v2/docs/research/harness-papers.md`

Papers fetched (SUMMARY; model-made extract, not paper text):
- Scaling Test-Time Compute for Agentic Coding, arXiv 2604.16529: https://arxiv.org/abs/2604.16529 (full-text fetch truncated at ~100k of 107k chars)
- R2E-Gym, arXiv 2504.07164: https://arxiv.org/html/2504.07164 (truncated at 100k of 118k chars)
- Agentic Rubrics as Contextual Verifiers for SWE Agents, arXiv 2601.04171: https://arxiv.org/html/2601.04171v1 (truncated at 100k of 126k chars)
- SWE-Verifier, arXiv 2610.30284: https://arxiv.org/abs/2610.30284 (abstract page only)
- Auditing Harness Tampering in Self-Improving Agents, arXiv 2609.00069: https://arxiv.org/abs/2609.00069 (abstract page only)
- EvilGenie, arXiv 2511.21654: https://arxiv.org/html/2511.21654
- Hardening Agent Benchmarks with Adversarial Hacker-Fixer Loops, arXiv 2606.08960: https://arxiv.org/abs/2606.08960 (abstract page only)
- Skill Issue: Lessons from Optimizing Repository SKILLs for Coding Agents, arXiv 2609.12742: https://arxiv.org/html/2609.12742 (truncated at 100k of 143k chars)
- Don't Break the Cache, arXiv 2601.06007: https://arxiv.org/html/2601.06007v2
- From Code Review to Code Critique (ARCTIC), arXiv 2607.29516: https://arxiv.org/abs/2607.29516 (abstract page only)
- Parallelizing Tool Execution and LLM Generation (PASTE), arXiv 2603.18897: https://arxiv.org/abs/2603.18897 (abstract page only)

Seen only as search results (SNIPPET; IDs are search-only, unchecked):
- SWE-Lego 2601.01426; SWE-World 2602.03419; SWE-ZERO to SWE-HERO 2604.01496; SWE-Marathon 2606.07682; Hack-Verifiable Terminal Bench 2608.22103
- Evaluating AGENTS.md 2602.11988; Boundary-Aware Skill Memory 2608.22339; Managing Procedural Memory in LLM Agents 2606.23127; CODESKILL 2605.25430; Code2Skill 2609.05571
- Darwin Gödel Machine 2505.22954; Speculate with Memory 2607.12236; IdleSpec 2605.22154
- Code Review Comprehension 2503.21455
- METR 2025 trial (news coverage only; the 2026 update is unverified secondary blog posts)
- Cloud Security Alliance note on coding-agent sandbox escapes (2026-07-22): https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-sandbox-escapes-20260722-c/
- Codex security docs: the fetch redirected to learn.chatgpt.com and the page I reached did not cover the sandbox; Codex sandbox facts rely on harness-papers.

Gaps: no primary source was read in full text; no controlled study of human reviewers or of rewind/background-agent UX was found; the Berkeley hybrid-verifier report cited in harness-papers was not re-checked.
