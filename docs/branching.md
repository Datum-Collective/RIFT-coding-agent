# Branching

| Branch | What it is for | Merges into |
| --- | --- | --- |
| `main` | Released and releasable code. Only changes through a pull request that passes `typecheck`. | tags `v*` publish a release |
| `external-fixes` | Fixes aimed at outside projects (OpenCode upstream, libraries): small, self-contained, easy to lift out as their own PRs. | `main` or the upstream project |
| `datum-internal` | Work specific to Datum: private integrations, internal tooling, settings that should not ship to everyone. | stays here; pull `main` into it regularly |
| `prototypes` | Throwaway experiments and spikes. Nothing here is expected to be stable. | `main` only after being rewritten as a normal PR |

Everything else is a short-lived branch off `main`, opened as a PR and deleted automatically when it merges. Name it with at most three words separated by hyphens, no slashes and no type prefix (`session-recovery`, `fix-scroll-state`), as `opencode/AGENTS.md` asks.

The four branches above are protected against deletion and force-push, so a PR merged from one of them does not remove it.
