# How RIFT follows OpenCode

`opencode/` is generated. It is an OpenCode release with RIFT on top, rebuilt by `rift/sync.sh`.

- `overlay/`: files only RIFT has, laid over `opencode/` at the same paths. New RIFT work goes here.
- `patches/`: the few edits to upstream's own files, one concern each. Keep them small. Every line here is a line
  an upstream release can conflict with, so prefer a plugin hook or an overlay file.
- `upstream.json`: the release `opencode/` was built from.
- `check.sh`: the gate. The contract test in `overlay/packages/core/test/plugin/rift-contract.test.ts` runs RIFT on
  upstream's real session runner with a scripted model, so a new RIFT feature needs a test there to be protected.

To change a patch, edit `opencode/`, then rewrite the patch from `git diff` against the release.
