# Research: what the papers say about building a lighter coding-agent harness

Written 2026-11-02. Source quality is marked on every claim: **read** means the text was read on the paper's HTML page, **summary** means a model-generated summary of the page, **snippet** means only a search-result abstract. arXiv IDs are as the search index returned them and should be checked before citing.

## The short version

1. The scaffold matters less as models get stronger. In NanoHarness's matched-model data (read), a heavy product harness's lead over bash-only mini-SWE-agent fell from +13.6 points (Claude 3.7 Sonnet) to +5.5 (Claude 4 Sonnet) on SWE-bench Verified. On DeepSeek-V4-Pro the gap was 34.3 vs 33.7 (read). A lighter harness gives up little on a strong model.
2. What does help is small and specific: structured file tools for weaker models, narrow task-specific subagents, and cheap context management that only acts when the window binds.
3. What does not help, or hurts: LLM-summary compaction as the default, recall/retrieval tools the model never calls, and general-purpose "architect / coder / tester" subagents.
4. The one thing every study agrees is missing from most harnesses is a mechanical verify-before-claim step. Only Hermes has one among eleven systems (read). RIFT already has this.

## Papers read

### An Empirical Study of Harness Design for Coding Agents (arXiv 2609.20804)
Fixed ReAct loop; varied planning, action space and context management; 4 models, SWE-Bench Verified and Terminal-Bench 2.1, 176 settings, one run per task (read).

- **Context management.** Five tiers from none to staged. The managed-minus-none gap shrinks with window size: 35.7 / 15.9 / 5.5 / 2.7 points at 32k / 64k / 96k / 128k on SWE-Bench. Without management, 78.7% of runs overflowed at 32k. Value comes from avoiding truncation. The best tier (T4) was rule-based elision of stale tool output at 0.6 of the window, then LLM summarization only at 0.85, keeping the last 0.3 of the budget verbatim. It was the cheapest in 7 of 8 panels.
- **Recall tools.** Letting the model retrieve elided content added nothing: 15 settings better, 14 worse, mean -0.36 points. 56% of settings never called it.
- **Planning.** Helps weak models (+11.6 points SWE for the 30B model, mostly by keeping it from quitting before its first edit: 68.6% of runs ended with no edit when planning was off). For strong models it changes cost, not accuracy: roughly -30% to -40% cost, accuracy within 2 points.
- **Action space.** Weak models need structured tools; without them 66% of one model's runs ended on calls the harness could not execute. A strong model did better with bash only (+3.6 SWE, +5.6 Terminal-Bench) at -30% to -53% cost. One strong model got +23.2 SWE from the full tool set, so it is model-dependent.
- **Safety pieces the harness kept:** read-before-write with content hash, path guard, tool errors returned as observations, post-edit lint, stuck detection (reminder after 5 identical calls, stop after 8 identical failures).
- **Caveat from the authors:** crossover points should be validated before transferring to other models or tasks.

### Beyond the Model: Harness Effects in SE Agents, NanoHarness (arXiv 2609.32459)
Five switchable components on top of mini-SWE-agent: tool registry, context compression, planning, subagents, lazy skills. Ten open-weight models. The first half of the page was read; the component tables are from a summary and should be checked against the PDF.

- Task-specific subagents and structured tools gave the most stable gains; context compression and general subagents could hurt (abstract, read).
- Summary figures, unverified: tools +4.6 / +3.5 points, task-specific subagents +5.9 / +4.5, context compression -4.9 / -3.9 despite cutting prompt tokens by 54-77%, planning and lazy skills small.
- Combined effect is not the sum of the parts. The full NanoHarness trailed OpenCode and Claude Code by about 1-2 points (summary).
- Caveat: component results are on ProgramBench (repository generation), not bug fixing, and were single runs at temperature 0.

### Harness Engineering: a source-code study of eleven systems (arXiv 2609.00006)
Eleven systems including OpenCode, Codex, Claude Code, Aider, OpenHands, Gemini CLI, mini-SWE-agent. Only part of the page was reachable. The 18 recommendations and the 90-line minimum harness were **not read**.

- 0 of 11 use an agent framework in the runtime; 0 of 11 use vector retrieval over code (read).
- Hermes is the only system to mechanize verify-before-claim, through a verify-on-stop guard (read).
- OpenCode's edit tool says it errors without a prior read, but the source has no read-tracking (read). Worth fixing in a RIFT overlay.
- OpenCode has no OS sandbox; Codex does (Seatbelt on macOS, Bubblewrap on Linux) (read).
- "Anti-gold-plating" directives appear in six systems; policy is migrating from prose into configuration and feature flags (read).

## Papers seen only as search snippets

Not read; treat as leads.

- **Context:** ACM, agentic context management (2607.23809); AutoCompact, learns when to compact (2610.02163); CliffCompaction (2609.26779); CoACT, action-preserving observation compression (2607.02911); ACON (2510.00615).
- **Verification:** hybrid execution-based plus execution-free verifiers reached about 51% against about 42-43% for either alone (Berkeley EECS-2026-52 snippet); SWE-Verifier, selective verification (2610.30284), reports that verifying every step raises total cost; LatentSift (2609.36371).
- **Self-evolving harnesses:** Self-HPO (2610.22791), HarnessDev (2609.01437), Ouroboros (2608.08311). Auditing Harness Tampering (2609.00069) warns that a loop which rewrites its own harness can tamper with the thing that evaluates it.

## What this means for RIFT

Keep RIFT's identity: it already does the part the field lacks.

| Idea | Evidence | RIFT action |
|---|---|---|
| Verify before claiming done | only 1 of 11 systems has it | already built (checks, diff-vs-summary); keep it core |
| Staged context management: elide old tool output at ~60% of the window, summarize only at ~85% | read, cheapest tier in 7 of 8 panels | replace LLM-first compaction; keep recent 30% verbatim |
| Task state outside the transcript | old RIFT `.rift/tasks`; supported by "summaries drop goals" and recall results | port: it is mechanical, not model-written |
| No recall/search-over-history tool | read, 56% never used | do not build |
| Planning on for weak models, off or minimal for strong | read | choose by model, not globally |
| Tool surface by model strength | read | structured tools for weak models, bash plus structured edit for strong |
| Narrow verification subagents (diff review, differential test) | summary, largest single gain | port as the Vibe Mode reviewer role; skip general subagents |
| Read-before-write tracking, stuck detection, post-edit diagnostics | read | add to an overlay; fixes a gap in OpenCode |
| Do not let the agent edit its own checks or harness | tampering paper (snippet) | keep verify config outside the agent's write scope |

## Open questions

- None of these results were measured on RIFT. The first thing to build is a small eval (a fixed set of tasks, run per model) so each change above is a measured one, not an assumed one.
- "Lighter harness on OpenCode's public API only" needs a decision: the v2 plugin API covers tools and hooks, but compaction and the system prompt may need patches.
