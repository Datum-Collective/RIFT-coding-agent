#!/usr/bin/env bash
# The gate every upstream update has to pass: RIFT compiles against it, RIFT's behaviour holds on its real
# runner, and the shipped binary starts. Run it after rift/sync.sh. Exits non-zero at the first failure.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/opencode"
want=$(python3 -c "import json;print(json.load(open('package.json'))['packageManager'].split('@')[1])")
[ "$(bun --version)" = "$want" ] || echo "warning: upstream pins bun $want, this is $(bun --version)" >&2

bun install --no-summary
(cd packages/core && bun run typecheck)
(cd packages/tui && bun run typecheck)
(cd packages/cli && bun run typecheck)

(cd packages/core && bun test --timeout 60000 test/plugin/rift-contract.test.ts test/plugin/rift-checks.test.ts test/plugin/rift-graph.test.ts test/plugin/rift-deep.test.ts)
(cd packages/tui && bun test --timeout 30000 test/koi test/banner.test.ts)

(cd packages/cli && bun run script/build.ts --single --skip-install --skip-web-ui)
binary=$(find packages/cli/dist -type f -name opencode -path '*/bin/*' | head -1)
"$binary" --version
echo "rift/check.sh passed"
