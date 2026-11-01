#!/usr/bin/env bash
# Asks an agent to repair RIFT for an upstream release that failed the gate. The agent is only trusted as far as
# this script checks it: it may change rift/ alone, never the gate, and the result must pass the unchanged gate.
# Repaired updates are for a person to review; they never merge on their own.
#
# usage: rift/repair.sh <version> [attempts]     RIFT_REPAIR_AGENT overrides the agent command.
# exit:  0 repaired and passing, 1 not repaired, 4 the agent broke the rules
set -uo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
version=$1
attempts=${2:-3}
agent=${RIFT_REPAIR_AGENT:-claude -p --permission-mode acceptEdits --allowedTools Read,Edit,Write,Grep,Glob}

protected() {
  git diff --name-only HEAD -- rift/check.sh rift/sync.sh rift/repair.sh rift/repair.md rift/regress.py rift/known-differences.txt .github
  git diff --name-only HEAD -- rift | grep -E '(^|/)(test|tests)/' || true
  git status --porcelain --untracked-files=all -- rift | sed 's/^...//' | grep -E '(^|/)(test|tests)/' || true
}

gate() {
  rift/sync.sh "$version" >/tmp/rift-failure.log 2>&1 && rift/check.sh >>/tmp/rift-failure.log 2>&1
}

for attempt in $(seq 1 "$attempts"); do
  if gate; then
    echo "repaired after $((attempt - 1)) attempts"
    exit 0
  fi
  echo "attempt $attempt: running the agent"
  $agent <rift/repair.md | tail -20
  broken=$(protected)
  if [ -n "$broken" ]; then
    echo "the agent changed what it may not:" >&2
    echo "$broken" >&2
    exit 4
  fi
done
if gate; then
  echo "repaired after $attempts attempts"
  exit 0
fi
echo "not repaired after $attempts attempts" >&2
exit 1
