# Branching

| Branch | What it is for | Merges into |
| --- | --- | --- |
| `main` | Released and releasable code. Only changes through a pull request that passes `ci`. | tags `v*` publish a release |
| `external-fixes` | Fixes aimed at outside projects (OpenCode upstream, libraries): small, self-contained, easy to lift out as their own PRs. | `main` or the upstream project |
| `datum-internal` | Work specific to Datum: private integrations, internal tooling, settings that should not ship to everyone. | stays here; pull `main` into it regularly |
| `prototypes` | Throwaway experiments and spikes. Nothing here is expected to be stable. | `main` only after being rewritten as a normal PR |

Everything else is a short-lived branch off `main` named `fix/...`, `feat/...` or `docs/...`, opened as a PR and deleted automatically when it merges.

The four branches above are protected against deletion and force-push, so a PR merged from one of them does not remove it.
