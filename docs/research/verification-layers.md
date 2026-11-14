# Verifying an agent's code: what each method catches, what it costs, what fits RIFT

Sources marked ✔ were looked up while writing this. Sources marked ○ are classic references cited from memory; check them before quoting.

## Methods

| Method | Catches | Costs | Fits RIFT? |
|---|---|---|---|
| **Test pyramid** (many unit, fewer integration, few end-to-end; Fowler, "TestPyramid" ○) | Unit: logic errors, fast and local. Integration: wiring and contract errors. E2E: whole-flow breakage. | Cost and flakiness rise up the pyramid. | Yes. `stages.ts` is already a CI ladder (install, format, lint, typecheck, build, test, e2e). It runs the project's own checks, so it needs no new infrastructure. |
| **Static analysis and type checking** (Tricorder at Google ○) | Whole classes of bugs with no execution: type errors, dead code, misuse of APIs. Deterministic, so no flakes. | Cheap. Only as good as the project's configured rules. | Yes, already staged (`lint`, `typecheck`). Cheapest signal, so it runs first and never hides a test result. |
| **Property-based testing** (QuickCheck, Claessen & Hughes 2000 ○; Hypothesis) | Edge cases nobody listed: boundary values, invariants broken by odd inputs. | Needs a good property. Writing properties is the hard part. | Partly. ✔ [Vikram, Lemieux, Padhye, "Can LLMs write good property-based tests?"](https://arxiv.org/pdf/2307.04346) found GPT-4 writes usable generators and assertions from documentation but only preliminary soundness. ✔ [Agentic Property-Based Testing](https://arxiv.org/pdf/2510.09907v1) reports an agent that proposes properties, runs Hypothesis and finds real bugs with few false alarms. Fits as an optional verifier stage, Python first. Not built yet. |
| **Mutation testing** (Just et al., "Are mutants a valid substitute for real faults?" 2014 ○) | Whether the tests would notice a bug. A surviving mutant is a place where the tests are blind. | Expensive: one test run per mutant. | Yes, already built (`mutation.ts`, `/verify` without `quick`). ✔ [Meta's ACH](https://arxiv.org/pdf/2501.12862) shows the cheaper form: few mutants aimed at one concern, rather than all of them. |
| **Differential testing** (McKeeman 1998 ○) | Behaviour change: run old and new code on the same input and compare. | Needs an oracle (the old version) and meaningful inputs. | Yes, in its simplest form. The pipeline compares the candidate with a baseline checkout of the same tree, so a failure is labelled *introduced* or *already failing*. |
| **Independent review** (Bacchelli & Bird, modern code review ○) | Misunderstood requirements, scope creep, weakened tests: things no automated check knows about. | A model call per review. Only independent if it does not see the author's reasoning. | Partly. `integrity.ts` catches weakened tests and checks mechanically. An LLM reviewer of the diff against the stated goal is **not built**; see the design. |
| **LLM-written tests and agent cross-checking** | Behaviour the project's own tests never covered. ✔ [CodeT](https://arxiv.org/pdf/2207.10397) selects among candidate solutions by agreement with generated tests and with each other (+18.8 points pass@1 on HumanEval with code-davinci-002). Its stated limits: only executable code, extra compute. ✔ [UTBoost](https://arxiv.org/pdf/2506.09289) found that augmenting SWE-bench's tests with generated ones flagged 15.7% of "passing" patches on SWE-bench Verified as wrong: passing the original tests is weak evidence. | Generated tests can encode the same misunderstanding as the code. | Yes, as a later stage. The lesson from both papers: the check has to come from somewhere other than the author's own claims. |

## What the sources say, in one paragraph

Passing the tests that exist is weak evidence (UTBoost). Tests an agent writes for its own code tend to agree with that code (CodeT's dual-agreement idea exists to counter this). So the verifier has to (1) run the project's checks itself, in a clean copy, (2) compare with a baseline so it can say what the change broke, (3) check that the checks have teeth (mutation) and were not weakened, and (4) never take the author's word for any of it.

## What RIFT already had (read from the code, not assumed)

- `rift-verify/workspace.ts` snapshots the tree and checks it out clean. The author's working directory is never trusted.
- `rift-verify/stages.ts` plans the project's own checks as a ladder; `pipeline.ts` runs them, reruns flaky kinds, and compares with the baseline.
- `integrity.ts` blocks weakened tests and checks. `mutation.ts` mutates and re-runs. `receipt.ts` seals each run in a hash chain.
- `rift-verify.ts` verifies continuously (debounced, in forked fibers, while the agent keeps editing) and gates the end of the turn: failures are sent back as a synthetic message, up to 3 rounds.

## What was weak, so what changed

1. The sidebar showed a command and a glyph. It did not say **why** the check ran or show **evidence**, so the user had to trust the glyph.
2. A failure sent back to the agent left no record of whether the agent fixed it, argued, or ran out of rounds. Nothing showed where the verifier and the agent **disagreed**.
3. No independent review of the diff against the goal.

Changes made: per-check `why` and `evidence` (the real output tail), a **dispute ledger** (opened when the verifier finds a failure after the agent ended its turn, closed as `resolved` only when a later run of the same check passes, or `unresolved` when the fix rounds run out), and sidebar rendering of both. Details in `verification-design.md`.

## Not done

LLM diff review against the goal, property-test generation, and differential testing against an old version beyond the baseline checkout are designed but not built. They need a decision on cost and on which model reviews (see the design doc).
