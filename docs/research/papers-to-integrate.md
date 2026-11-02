# Research: papers whose ideas change how people work WITH a coding agent

Written 2026-11-02. Builds on `harness-papers.md`, `revolutionary-features.md`, `harness-choice.md`. Nothing from those is repeated; where a paper touches them, the new angle is stated.

## How to read the evidence marks

The fetch tool in this session does not return page text. It returns an answer written by a small model to a prompt I supply, plus a note saying how many characters of the page it covered. I fetched arXiv HTML pages and asked for method, numbers and limitations, and paged by offset where the note said the page was longer. That is better than an abstract, but it is still model-written, so I mark every paper **SUMMARY-X** ("targeted extraction of the HTML text; numbers quoted by the extractor; I did not see the raw page"). I did not obtain READ-FULL for any paper. Each entry says which characters were covered. Numbers are author-reported. arXiv IDs below were all fetched successfully unless marked "search-only".

OpenCode-side claims were checked against source in `/Users/shiv/Developer/rift-sync/rift-v2/opencode/packages` (cited per paper). I did not verify the TUI plugin route; `packages/plugin/src/tui` does not exist, so anything that needs a TUI panel is marked "TUI location unverified".

## 1. Ranked table

| # | Paper | One-line idea | Evidence | Read level | Build |
|---|---|---|---|---|---|
| 1 | Ask or Assume, 2603.26233 | A separate intent check decides when the agent must stop and ask the user before editing | Medium: 500 tasks, simulated user, 2 models | SUMMARY-X, chars 0-100000 of 100321 | Medium |
| 2 | Agentic Uncertainty Reveals Agentic Overconfidence, 2602.06948 | Do not trust or show the agent's own "I think it works"; bug-hunting review prompts calibrate better | Medium-low: 100 tasks, prompting only | SUMMARY-X, whole page | Small |
| 3 | How AI Impacts Skill Formation, 2601.20245 | RCT: delegating to AI lowers later comprehension and debugging; asking for explanations preserves it | Medium: randomized, N=52, one task | SUMMARY-X, main text (extractor omitted appendices) | Small |
| 4 | (Im)Paired Programming, 2607.26375 | Agent users understand their code less; reviewing each file vs auto-accept shows a comprehension gap | Medium-low: randomized, N=54 students, sub-analyses exploratory | SUMMARY-X, chars 0-100000 of 190373 | Small |
| 5 | SWE-chat, 2604.20779 | Real-use telemetry: users interrupt or push back on 50% of turns, agents ask 3%, 59% of agent code survives | Observational, ~18,000 sessions, opt-in early adopters | SUMMARY-X, chars 0-100000 of 168574 | Small (telemetry) |
| 6 | The Work Behind Delegation, 2609.24234 (with 2606.05391) | Supervision is plan, monitor, wait, review, teach, fix, update assets; tools should keep the plan alive and tie changes to rationale | Qualitative, N=19 and N=17 interviews | SUMMARY-X, chars 0-100000 of 148525 and 158328 | Medium |
| 7 | SWE-ContextBench, 2602.08316 | Reusing past experience helps only when it is a short, correctly chosen summary; free retrieval did not help and cost more | Medium-low: 99 tasks for the memory arms | SUMMARY-X, whole page | Medium |

## 2. Per-paper entries

### 1. Ask or Assume: uncertainty-aware clarification (arXiv 2603.26233, Edwards and Schuster)

**Claim.** When a task is underspecified, a coding agent that asks the right question before editing recovers most of what it loses by guessing. A second, dedicated "intent" agent that only judges "is this underspecified?" and forces a question works better than telling one agent to self-assess.

**Evidence (SUMMARY-X).** OpenHands, 100-iteration cap, on a 500-issue underspecified variant of SWE-bench Verified made by having GPT-4o strip details. A 10-instance spot check found the removed information essential in 5 and not in 5. User answers come from a GPT-5.1 simulator limited to 3 turns. Claude Sonnet 4.5 resolve rates: full spec 70.8, underspecified with no asking 54.8, single-agent self-assess 61.2, multi-agent (intent agent forces the question) 69.4, always-ask baseline 70.4. Multi-agent vs single p<0.001; multi-agent vs always-ask p=0.621, so on Claude it does not beat simply asking every time. Kimi K2.6: multi-agent 69.4, always-ask 47.2 (that model misuses the finish tool to ask). Asking was not rare: Claude multi-agent asked on 344 of 500 tasks, 3.06 questions per asking task; on the 156 tasks it did not ask it resolved 76.92% against 77.56% for the hidden-info baseline, which is the calibration evidence. Cost per task: full $1.63, always-ask $1.40, single $2.03, multi-agent $3.50. Caveats: simulated users are "unnaturally cooperative" (authors), one benchmark, frontier models only, extractor covered all but the last 321 characters.

**What the RIFT user experiences.** A vague prompt ("make search faster") is not edited blindly. Before the first edit RIFT shows one to three targeted questions, each with a recommended answer, or states the assumptions it will proceed under. A clear prompt goes straight through with no extra friction.

**How to build (OpenCode v2.2.5).** Plugin, no patch for the logic.
- The ask surface exists: `packages/core/src/tool/plugin/question.ts` (the `question` tool, with options and a "type your own answer" path).
- Gate: `ctx.session.hook("prompt")` or `"context"` in `packages/plugin/src/effect/session.ts` (`SessionHooks` lists `prompt`, `context`, `compaction`, `generate`, `model.request`, `retry`, `experimental.idle`) to run the intent pass on the first user turn; the intent judge can use `ctx.session.generate` (in the `SessionDomain` Pick list) so it does not share the main context.
- Enforce "ask before first edit": `ctx.tool.hook("execute.before")` in `packages/plugin/src/effect/tool.ts` can reject an edit/write call with a failure telling the model to call `question` first while the intent flag is set. (`revolutionary-features.md` already read that only `execute.before` may fail.)
- Note `core/src/plugin/plan.ts` exists (Plan agent); this is different, it is a pre-edit clarification step, not a plan mode.

**Main risk.** Question fatigue and 2x cost (Table: $3.50 vs $1.63). The paper's own always-ask result on Claude is within noise of the gated version, so the gate's value is fewer needless interruptions, which the paper does not measure with real humans. Ship with a per-session budget of questions and a "stop asking" key.

**How RIFT measures it.** Take 30 real prompts from the user's history, strip them to a vague form, run three arms (no ask, always-ask, intent-gated) with the user's real answers recorded once and replayed. Metrics: hidden-test pass, questions per task, cost, and a "was the question answerable only by the user" rating.

**New angle vs earlier docs.** `revolutionary-features.md` has no clarification feature at all; `harness-papers.md` only covers planning for weak models.

### 2. Agentic Uncertainty Reveals Agentic Overconfidence (arXiv 2602.06948, Kaddour et al.)

**Claim.** Coding agents are badly overconfident about their own patches, and their confidence barely separates right from wrong. Asking the same model to look for bugs instead of confirm correctness lowers overconfidence.

**Evidence (SUMMARY-X, whole page seen by extractor).** 100 random SWE-bench Pro tasks; GPT-5.2-Codex, Gemini 3 Pro, Claude Opus 4.5 on mini-swe-agent; each model is its own judge. Base success 35%, 22%, 27%. Mean post-execution self-estimate: about 73% GPT, 77% Gemini, 61% Claude. AUROC of the estimate is near chance: post-execution 0.58 / 0.51 / 0.55; before-execution 0.62 / 0.53 / 0.64; mid-run estimates stay near 0.5 for GPT and fall for Claude (0.62 to 0.52). Failing runs were overconfident 62% of the time against 11% underconfidence on passing runs. Bug-finding framing: ECE 0.42 to 0.30 (GPT) and 0.37 to 0.24 (Claude); overconfident failures (>=0.7 predicted) 72% to 45%; cost per instance $0.23 to $0.52. For GPT, Platt rescaling reached ECE 0.01, so part of the gain is just recalibration. No escalation or early-stop experiment was run; the authors only motivate it. Caveats: 100 tasks, only 22 positives for Gemini, pairwise differences mostly not significant, prompting only.

**What the RIFT user experiences.** RIFT never prints "I'm 90% confident". The "done" screen leads with check output and the proof receipt. Optionally, an adversarial second pass ("find what is wrong with this diff") runs and its findings, not a score, are listed. The user learns not to read agent self-assessment as evidence.

**How to build.** Mostly a policy plus a small plugin.
- Adversarial pass after verify: `ctx.session.hook("experimental.idle")` or the existing `rift-verify` flow (`packages/core/src/plugin/rift-verify.ts`, `rift-verify/receipt.ts`, `rift-verify/deep.ts` exist; I did not read their bodies this session, so wiring into `deep.ts` is an assumption to check) calls `ctx.session.generate` on diff only, with a bug-finding prompt.
- Do not add a confidence number to the receipt. If the user wants a calibrated score, it must be fitted on RIFT's own outcomes (Platt on recorded check results), not self-reported.

**Main risk.** The paper shows the bug-hunt prompt reduces but does not remove overconfidence and doubles cost; it can also create false alarms that train users to ignore it. Show findings as advisory, never as a veto over passing checks.

**How RIFT measures it.** On the 20-40 task eval from `revolutionary-features.md`, record for each "done": checks pass, hidden tests pass, adversarial findings count. Report precision of "done" with and without the findings used as a flag, and false-alarm rate per 10 runs.

**New angle.** `revolutionary-features.md` #3 proposed a rubric verdict and said judges can supplement checks; this paper gives direct evidence that self-reported confidence should not be shown at all and that the reviewing prompt matters.

### 3. How AI Impacts Skill Formation (arXiv 2601.20245, Shen and Tamkin)

**Claim.** In a randomized experiment, developers who used an AI chat assistant to learn a new library scored lower on a no-AI comprehension quiz, with no reliable time saving. How they used the AI mattered.

**Evidence (SUMMARY-X, main text; extractor omitted appendices).** Between-subjects, 52 analyzed (26 AI, 26 control) recruited via a crowd platform, over one year of Python, no prior Trio experience. Trio task capped at 35 minutes, then a 27-point, 14-question quiz without AI. AI group about 4.15 points lower (about 17%), Cohen's d = 0.738, p = 0.010. Time: no significant speedup (AI "delegation" group 19.5 min vs 23 control). Six interaction patterns: low scorers (24-39% average) were AI Delegation (n=4), Progressive Reliance (n=4), Iterative AI Debugging (n=4); high scorers (65-86%) were Generation-Then-Comprehension (n=2), Hybrid Code-Explanation (n=3), Conceptual Inquiry (n=7). A pilot (n=20) showed a larger effect. Authors' caveats: a chat assistant (GPT-4o), one task, measured within about an hour, no job incentive to learn, small pattern groups.

**What the RIFT user experiences.** A "learning" or "own it" setting. After a non-trivial change RIFT asks two or three questions about what it just did (user answers in a line each), or offers "explain this diff to me" with the explanation tied to hunks. Off by default for throwaway work, on by choice for code the user must maintain.

**How to build.** Plugin.
- Trigger after the turn: `ctx.event.subscribe` (`packages/plugin/src/effect/event.ts`) on session idle/turn-complete, or `session.hook("experimental.idle")`.
- Question UI: reuse the `question` tool path (`core/src/tool/plugin/question.ts`) or `core/src/form.ts` for user-facing prompts (I did not read `form.ts`).
- Explanation text via `ctx.session.generate` from the diff (`ctx.vcs`, `packages/plugin/src/effect/vcs.ts`).

**Main risk.** Friction; users will switch it off. Evidence is about learning a new library, not about maintaining your own repo, and the effect is on a one-hour retention test. Do not claim it improves code quality.

**How RIFT measures it.** Opt-in A/B on the author's own use: same-week tasks with explain-back on or off, then a 5-question quiz on the diff two days later written from the diff by a model and checked by the user. Compare score and added minutes.

**New angle.** Neither earlier doc addresses what the human retains; they only improve output reliability.

### 4. (Im)Paired Programming (arXiv 2607.26375)

**Claim.** Agent users finish faster but understand their code less than chatbot users; how they review matters.

**Evidence (SUMMARY-X, chars 0-100000 of 190373).** Between-subjects, 54 CS students analyzed (59 recruited, 5 failed attention checks). Agent arm: Aider + GPT-4.1 editing their code; chatbot arm: GPT-4.1 limited to snippets of 5 lines or fewer. 50-minute build of a tic-tac-toe variant, then comprehension questions on the user's own code, then a 20-minute extension with the chatbot. Agent users were more accurate and faster on the build (values only in a figure), comprehension lower with p<0.002, d>0.80 (figure caption). Exploratory sub-analyses (some n=27): comprehension 0.615 for auto-accept vs 0.777 for reviewing each file; copying criteria into the prompt 0.654 vs turning criteria into code-like syntax 0.743. Agent users rated the tool more helpful (4.7 vs 3.3) and understood their code less (3.3 vs 4.2). Caveats: students, one agent, LLM-scored rubrics, short-term only.

**What the RIFT user experiences.** Per-file review as the default review flow after an agent turn, with a visible "files you looked at / not looked at" list on the receipt, rather than one accept-all button.

**How to build.** Plugin plus TUI; diff source is `ctx.vcs` (`packages/plugin/src/effect/vcs.ts`), and the receipt already exists in `rift-verify/receipt.ts`. Tracking which files the user opened is a TUI-side state, TUI location unverified.

**Main risk.** The auto-accept vs per-file result is exploratory and confounded (users who review may differ). Treat it as a hypothesis RIFT tests, not a result.

**How RIFT measures it.** Count reviewed-file coverage per accepted change; later correlate with reverts and with defects found within 7 days (via `git` history).

**New angle.** Complements `revolutionary-features.md` #4 (intent-level review): that proposal ranks hunks, this one measures whether the human actually read them.

### 5. SWE-chat: coding-agent interactions from real users (arXiv 2604.20779)

**Claim.** Real-world use differs sharply from benchmark assumptions: users correct agents constantly, agents almost never ask, and much agent code is thrown away.

**Evidence (SUMMARY-X, chars 0-100000 of 168574; appendices C.5 onward not seen).** Almost 18,000 sessions, more than 229,000 user prompts, 2 million tool calls, 700+ repositories, from opt-in logging (Entire.io CLI) across eight agents (about 69% Claude Code in the September version). Users interrupt in 4.5% of turns and push back in 45.7% (50.2% combined); agents stop to ask in about 3.0-3.2% of turns. Agents wrote 55.3% of committed lines on average; sessions: 25.0% human-only, 33.9% collaborative, 41.1% "vibe coding" (agent writes over 99%). Only 59.4% of agent-produced code survives into commits. Median cost per 100 committed lines: $2.71 vibe, $1.33 human-only, $0.92 collaborative. Semgrep: 0.47 vulnerabilities per 1,000 committed lines in vibe sessions vs 0.12 human-only and 0.15 collaborative (about 3.8x). Authors' limits: early adopters, no proprietary enterprise code, abandoned sessions unlogged (overestimates success), LLM-made labels imperfect, 16% of sessions from one repo. Observational, so the vulnerability and cost comparisons are not causal.

**What the RIFT user experiences.** A local `rift stats` view: pushback rate, interruptions, how much agent code survived to commit, cost per surviving 100 lines, by mode. Nothing leaves the machine.

**How to build.** Plugin, no patch. `ctx.event.subscribe` (`packages/plugin/src/effect/event.ts`) for session events, `ctx.storage` (`packages/plugin/src/effect/storage.ts`) for the log, `ctx.vcs` to compute survival at commit time. `packages/core/src/event-logger.ts` and `core/src/session` exist; I did not read them, so check whether the session event log already holds enough to derive "pushback" without new capture.

**Main risk.** Defining "pushback" automatically needs a model classifier; mislabeling pollutes the stats. Start with mechanical signals (interrupt, revert, same-file re-edit within N turns, user message following a failed check).

**How RIFT measures it.** This is the measurement layer for every other feature. Baseline for two weeks before enabling anything else.

**New angle.** `harness-papers.md` says "build a small eval first"; this paper supplies the in-use metrics to log.

### 6. The Work Behind Delegation (arXiv 2609.24234) with the oversight interviews (arXiv 2606.05391, Dhanorkar et al.)

**Claim.** Supervising an agent is a loop of seven stages, and tools should help with three recurring demands: intent alignment, quality beyond "it runs", and keeping a mental model of what changed.

**Evidence (SUMMARY-X, each chars 0-100000; 148525 and 158328 characters total).** 2609.24234: 19 experienced developers, remote sessions of about 90 minutes (interview, think-aloud on their own task capped at 40 minutes, diagramming their supervision workflow); stopped at 19 when no new stages appeared. Stages: Plan, Monitor, Wait, Review, Teach, Manual Fix, Update Assets (update instruction files and docs so the next plan benefits). A secondary pass over 102 Reddit threads. Design implications: preserve intent during execution, surface ambiguous requirements, keep the plan accessible, highlight important changes and link them to the agent's rationale. 2606.05391: 17 interviews (12 at the authors' own company); four forms of oversight (a priori control, co-planning, real-time monitoring which participants rarely did, post hoc review the most discussed). Users relied on shortcuts that the authors call imperfect: plan equals what it did, passing tests means correct, skimming reveals problems. Reported intervention triggers: drift, unusually long runs or many turns, agent doing unrequested things, test failures. No intervention criteria are defined. Qualitative, self-reported, small N, mostly one company.

**What the RIFT user experiences.** (a) The approved plan stays pinned at the top of the session and every change is tagged "in plan / outside plan". (b) A "while you were away" digest after a long run: what changed, why (the agent's own line per hunk), what failed. (c) When a check fails and is fixed, RIFT offers to record the lesson (this is the existing lessons-ledger idea, now justified by the "Update Assets" stage).

**How to build.**
- Pinned plan and scope tags: `ctx.session.hook("context")` can inject the plan each turn (cache-prefix caveat from `revolutionary-features.md` #7 applies; append, do not edit the prefix); compare diff files against plan files via `ctx.vcs`.
- Digest: `session.hook("experimental.idle")` (in `SessionHooks`) plus `ctx.event.subscribe`; summary via `ctx.session.generate`.
- Interrupt triggers: turn-count and run-time thresholds are mechanical; `ctx.session.interrupt` is in `SessionDomain`.
- UI location unverified.

**Main risk.** The studies are descriptive, so they justify what to build but not that it improves outcomes. The "outside plan" tag depends on the plan being specific enough to compare.

**How RIFT measures it.** Count scope-creep hunks flagged vs hunks the user later reverted; time from "agent finished" to "user accepted"; whether the user opened the digest.

**New angle.** `revolutionary-features.md` #6 (background runs) lacked any human-factors evidence; this gives the flow (monitor/wait/review) and what to surface.

### 7. SWE-ContextBench: context learning in coding (arXiv 2602.08316)

**Claim.** Letting an agent reuse experience from earlier tasks helps only when what it reuses is short and correct; otherwise it is neutral or harmful.

**Evidence (SUMMARY-X, whole page).** 1,476 tasks (1,100 base, 376 related) over 51 repositories and 9 languages, built from SWE-bench Lite, Multilingual and Verified. Context pool is Claude Code trajectories on the base tasks, not filtered for quality. Arms on 99 Lite related tasks, Claude Sonnet 4.5: no context 26.26%, free (agent chooses to retrieve) full trajectory 26.26%, oracle trajectory 27.27%, free summary 22.22%, oracle summary 34.34% (summary about 217 tokens vs about 25,600 for a trajectory). Memory frameworks: Mem0 24.24, OpenViking 29.20, Supermemory 30.30. Across five agents, oracle summaries lifted resolve rates by about 1.1 to 5.3 points. Cost: free-context retrieval $0.98 vs $0.79 baseline; oracle summary $0.85 on Lite (the paper says summary reuse does not cut cost on Lite, though five-agent costs fell, for example $0.67 to $0.55). Free retrieval matched the right task only 18.18% of the time. Authors note agents copy mistakes from trial-and-error trajectories. Caveats: 99 tasks, small, unfiltered pool, no human validation of every instance.

**What the RIFT user experiences.** Lessons are tiny (one to three lines), tied to a task type or file area, attached only when RIFT detects a related task, and visible. No hidden "memory" the user cannot read.

**How to build.** Plugin. Storage `ctx.storage` (`packages/plugin/src/effect/storage.ts`), injection via `ctx.skill` (`packages/plugin/src/effect/skill.ts`) or the `context` hook. Matching related tasks by shared files from `ctx.vcs` is cheaper and more reliable than semantic retrieval; the 18.18% retrieval accuracy here is the thing to avoid.

**Main risk.** Wrong summary selected makes results worse than nothing (free summary was below baseline). Gate with exact file overlap and require user approval at write time.

**How RIFT measures it.** Same as `revolutionary-features.md` #9: held-out tasks, with and without ledger, tokens added logged.

**New angle.** `revolutionary-features.md` #9 relied on Skill Issue and AGENTS.md results (negative on free-form notes). This adds the finding that short, correctly matched summaries can help while agent-chosen retrieval does not, which sets the design: retrieve by rule, store summaries not transcripts. It agrees with `harness-papers.md` (no recall tool).

## 3. Papers that looked promising but did not hold up

- **Spec Kit Agents, 2604.05278 (SUMMARY-X, whole page).** Specify, Plan, Tasks, Implement pipeline. The tempting claim is "spec-first improves outcomes". The data do not show it: judge composite Baseline 3.46 vs Full 3.51; the gain (3.66) comes from the context-grounding hooks (+0.15, p<0.05, LLM judge Opus 4.6, single generator MiniMax-M2.5), not from writing the spec. Plan review was auto-approved, so no human approved any spec. Human blinded votes: 8 for Full-Augmented, 19 for Full, 33 ties. Full-Augmented took 37.2 min vs 24.0. The paper gives two different numbers for the same gain (+4.27% in the table, +3.0% in the abstract). No evidence here that a human-approved spec helps. I found no controlled study that does; this is a gap, not a settled "no".
- **Rethinking the Value of Agent-Generated Tests, 2602.07900 (SUMMARY-X, chars up to the references).** 500 SWE-bench Verified tasks, six models, mini-SWE-agent. Telling agents to write more tests flipped behaviour on 37-64% of tasks with net success changes of 0 and -5; telling them to write fewer cost -13 and -9 successes but cut input tokens 33-49%. Conclusion: test volume changes cost, not outcomes. Useful as a warning against forcing "tests first" prompts; it does not test human-approved tests before code.
- **At Equal Inference Cost, Multi-Agent Structure Does Not Beat a Single Frozen Agent, 2609.04217 (SUMMARY-X).** Planner-executor-critic vs single: 0.769 vs 0.754 on ALFWorld (p=0.80) at 1.79x calls. But it is a frozen 7B Qwen on ALFWorld and WebShop, one seed, not coding. It cannot decide whether RIFT should do multi-agent coding. I found no coding paper with a cost-matched multi-agent comparison; the only coding multi-attempt paper I know of is 2604.16529, already in `revolutionary-features.md`.
- **METR uplift update (blog, evals.alignment.org, search snippet only).** Not a paper. The snippet says the new cohort estimate was -4% (CI -15% to +9%) and METR itself called selection effects severe; secondary posts misreport it as a speedup. Not usable as evidence for or against any feature.
- **Self-Evolving Coding Agents, 2608.03392 (SUMMARY-X, chars 0-100000 of 323368).** A survey. It reports that CTIM-Rover's cross-task memory did not beat its baseline and argues evaluation must use held-out later tasks. It is a pointer, not primary evidence; consistent with entry 7.
- **SWE Together, 2606.29957 (SUMMARY-X, whole page).** Benchmark replaying 109 tasks from 11,260 real sessions against a simulated user; its "User Correction" metric correlates -0.92 with pass@1. Interesting as a RIFT eval metric, but the user is simulated (46% Turing pass rate), two replicates, 109 tasks. Not an integration target; I borrowed the metric idea only.
- **SWE-Bench-CL (2507.00014), MemGovern (2601.06789), SWE-MeM (2606.28434), Anthropic and METR RCT coverage, AIDev PR studies (2601.18749, 2602.02345, 2602.04226, 2601.15195), TDAD 2603.17973, 2604.06723, 2606.29490, 2601.07264, 2604.13107.** SNIPPET only (search results); not read, not used for claims.

## 4. Recommended order for the first three integrations

1. **Local telemetry and correction metrics (paper 5, with the SWE Together metric).** Small and plugin-only. Everything else in this file and in `revolutionary-features.md` needs a baseline; the first honest question RIFT should answer about itself is how often its user pushes back and how much agent code survives.
2. **Clarify-before-edit gate (paper 1).** Strongest evidence of the set and the clearest change in how a person works with the agent: the agent stops guessing. It has a real existing hook (`question` tool, `execute.before`). Run it behind the eval from step 1 since cost roughly doubled in the paper and the benefit over always-asking is unproven on Claude.
3. **No self-reported confidence plus an adversarial review pass on the receipt (paper 2), with per-file review tracking (paper 4).** Small, extends the existing proof receipt, and the evidence agrees that agent self-assessment is not a signal. Add the explain-back option (paper 3) as an opt-in toggle in the same release since it shares the post-turn hook.

Pinned plan and digest (paper 6) and the lessons ledger (paper 7) follow once background runs exist.

## 5. Sources and read level

All read levels are SUMMARY-X unless stated (model-written targeted extraction of the HTML text; see top). "Chars" = characters of page text the extractor covered.

- 2603.26233 Ask or Assume: https://arxiv.org/html/2603.26233v2 (chars 0-100000 of 100321)
- 2602.06948 Agentic Uncertainty Reveals Agentic Overconfidence: https://arxiv.org/html/2602.06948 (whole page)
- 2601.20245 How AI Impacts Skill Formation: https://arxiv.org/html/2601.20245 (main text; abstract page also fetched, SUMMARY)
- 2607.26375 (Im)Paired Programming: https://arxiv.org/html/2607.26375 (chars 0-100000 of 190373)
- 2604.20779 SWE-chat: https://arxiv.org/html/2604.20779 (chars 0-100000 of 168574)
- 2609.24234 The Work Behind Delegation: https://arxiv.org/html/2609.24234 (chars 0-100000 of 148525)
- 2606.05391 oversight interviews (Dhanorkar, Passi, Vorvoreanu): https://arxiv.org/html/2606.05391 (chars 0-100000 of 158328)
- 2602.08316 SWE-ContextBench: https://arxiv.org/html/2602.08316 (whole page)
- 2604.05278 Spec Kit Agents: https://arxiv.org/html/2604.05278 (whole page)
- 2602.07900 Rethinking the Value of Agent-Generated Tests: https://arxiv.org/html/2602.07900v1 (chars 0-100000 of 110563)
- 2609.04217 Equal Inference Cost: https://arxiv.org/html/2609.04217 (chars 0-100000 of 133741)
- 2608.03392 Self-Evolving Coding Agents: https://arxiv.org/html/2608.03392 (chars 0-100000 of 323368)
- 2606.29957 SWE Together: https://arxiv.org/html/2606.29957 (whole page)
- SNIPPET (search result only; not read): METR uplift update https://evals.alignment.org/blog/2026-02-24-uplift-update/; 2507.00014, 2601.06789, 2606.28434, 2601.18749, 2602.02345, 2602.04226, 2601.15195, 2603.17973, 2604.06723, 2606.29490, 2601.07264, 2604.13107, 2603.14225, 2607.14037, 2606.13175.

OpenCode source consulted (listing and targeted reads, under `/Users/shiv/Developer/rift-sync/rift-v2/opencode/packages`): `plugin/src/effect/session.ts` (SessionHooks and SessionDomain lists), `plugin/src/effect/event.ts` (`subscribe`), `plugin/src/effect/tool.ts` (`execute.before` / `execute.after` entries), `core/src/tool/plugin/question.ts` (head), `core/src/plugin/plan.ts` (head), directory listings of `core/src/plugin/` and `core/src/plugin/rift-verify/` (files present: checks.ts, deep.ts, graph.ts, integrity.ts, receipt.ts). Not verified: TUI plugin location, bodies of the rift-verify files, `core/src/form.ts`, `core/src/event-logger.ts`.
