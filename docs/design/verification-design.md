# Verification layer: design

Read `docs/research/verification-layers.md` first. This is the design that came out of it, with what is built and what is not.

## Principle

The verifier never takes the agent's word for anything, and the user never has to take the verifier's. So every claim the verifier makes must come with the thing it was made from.

## Independence (built, already true of the pipeline)

- The verifier runs in the same process as the agent but shares none of its reasoning. It reads a **git snapshot** of the work tree (`workspace.ts`), checks it out clean, and runs the project's own commands there. What the agent says it did is not an input.
- It runs **in parallel**: every source edit starts a debounced run in a forked fiber (`verifyEdits`) while the agent keeps working; only the newest edit's run executes.
- It compares with a **baseline checkout**, so a failure is labelled introduced by the change or already failing.
- `integrity.ts` fails a run when the agent weakened a test or a check; `mutation.ts` checks the tests can fail at all.
- At the end of the turn the verifier gates the agent: failures go back as a message, up to 3 rounds, then the user is told the work is not proven.

## Inspectability (built in this change)

Every check in the run carries, in the stored state the sidebar reads (`Rift.Stage`):

| Question | Field | Source |
|---|---|---|
| **Why** was it run | `why` | `RiftStages.why(kind)`: one sentence per kind of check |
| **What** ran | `command` | the exact command from the plan |
| **Result** | `status`, `introduced`, `preexisting`, `ms` | the process outcome and baseline comparison |
| **Evidence** | `evidence` | a failure: the last 12 lines (900 chars) of the real output of its last attempt. A pass: exit status, time, and the sha256 of the full output, which the sealed receipt also holds |

Evidence is raw program output or a digest of it. No model writes it.

**Disagreement** is a ledger (`Rift.Dispute`, `rift-verify/disputes.ts`), kept per session:

- opens when the agent ended its turn with a check failing and was sent back (claim, evidence, round);
- closes `resolved` only when a later finished run passes that same check (by stage id), recording the receipt prefix of that run;
- closes `unresolved` when the fix rounds run out, so a disagreement the agent never answered stays visible;
- a check that fails again after being resolved opens a new dispute.

The rules are pure functions with their own tests. The plugin only feeds them runs it has stored.

## Sidebar

Same layout, extended in place (`sidebar/rift.tsx`, `sidebar/rift-run.ts`):

- failed, flaky and not-run checks are always spelled out (why, ran, result, output);
- passing checks are one line; clicking the run's title (▸/▾) opens all of them;
- a "Verifier vs agent" section lists disputes with the verifier's claim and the outcome.

## Not built (needs a decision)

1. **Independent LLM review of the diff against the stated goal.** It should run as a separate session on a different model, receive only the user's original request and the diff (never the agent's transcript), and return findings with quoted diff lines as evidence. It costs one model call per turn and needs a choice of model. The place for it is a new stage kind beside the others, with the same `why`/`evidence` fields and the same dispute ledger.
2. **Property-based test generation** (Hypothesis / fast-check), as an optional stage once the project has the library.
3. **Dispute opening mid-turn.** Today disputes open at the end-of-turn gate, because that is the only point at which the agent is told. Continuous results show in the sidebar but do not interrupt the agent.

## Repair, ready, and RIFT as a contributor

**Repair (`rift-verify/repair.ts`).** When the agent ends its turn with a failing check, the instruction it gets asks for a one-sentence diagnosis tied to a line of the output before any edit. Each round records a *signature* of the failure (which checks failed and what they said, minus numbers and timings). If a fix leaves the signature unchanged, the next instruction says its diagnosis was wrong and asks for a different one; after two fixes that changed nothing the loop stops and the agent tells the user, instead of spending the remaining rounds. The cap of 3 rounds still applies when the failure keeps changing. Every instruction forbids weakening the checks, and `integrity.ts` still blocks it.

**Ready (`rift-verify/ship.ts`, `/ship <message>`).** "Ready" is one rule: a finished run, verified, of the tree as it is now, with no verifier/agent disagreement left open. `/ship` checks it and either refuses with the reasons or commits. It commits locally and never pushes. RIFT never commits on its own.

**Contributor credit.** GitHub lists a co-author on the repository's Contributors page when the `Co-Authored-By` email belongs to an account. That is why `claude` appears: the email on its trailer is the `claude` account's. For RIFT to appear, someone must:
1. create a GitHub account for RIFT (for example `rift`) and, in its settings, note its noreply address, `<id>+<username>@users.noreply.github.com`;
2. set `RIFT_COAUTHOR="RIFT <that address>"` where RIFT runs.

Until then `/ship` commits without a trailer and says so. The email is never guessed. Whether GitHub counts a given commit toward the contributor list depends on it being on the default branch.

## Not built here

Sidebar states for "repairing / ready / blocked" (the gate result is in the notice, not yet the sidebar); automatic PR descriptions with the footer; a settings-file option in place of the environment variable.
