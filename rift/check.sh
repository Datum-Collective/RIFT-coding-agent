#!/usr/bin/env bash
# The gate every upstream update has to pass: RIFT compiles against it, RIFT's behaviour holds on its real
# runner, the shipped binary starts, and upstream's own suites find no regression. Run it after rift/sync.sh. Exits non-zero at the first failure.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/opencode"
want=$(python3 -c "import json;print(json.load(open('package.json'))['packageManager'].split('@')[1])")
[ "$(bun --version)" = "$want" ] || echo "warning: upstream pins bun $want, this is $(bun --version)" >&2

bun install --no-summary
(cd packages/core && bun run typecheck)
(cd packages/tui && bun run typecheck)
(cd packages/cli && bun run typecheck)

(cd packages/core && bun test --timeout 60000 test/plugin/rift-contract.test.ts test/plugin/rift-stages.test.ts test/plugin/rift-verdict.test.ts test/plugin/rift-workspace.test.ts test/plugin/rift-pipeline.test.ts test/plugin/rift-integrity.test.ts test/plugin/rift-graph.test.ts test/plugin/provider/claude-agent)
(cd packages/tui && bun test --timeout 30000 test/koi test/banner.test.ts test/feature-plugins/rift-sidebar.test.ts test/feature-plugins/rift-sidebar-render.test.tsx test/feature-plugins/rift-log.test.ts test/feature-plugins/rift-go-upsell.test.ts test/rift-composer.test.tsx test/rift-field-size.test.tsx)

(cd packages/cli && bun run script/build.ts --single --skip-install --skip-web-ui)
binary=$(find packages/cli/dist -type f -name opencode -path '*/bin/*' | head -1)
"$binary" --version
python3 ../rift/regress.py
echo "rift/check.sh passed"
