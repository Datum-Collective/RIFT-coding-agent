#!/usr/bin/env bash
# Rebuilds opencode/ from an upstream release: the release, then rift/overlay, then rift/patches.
# opencode/ is generated. Change RIFT in rift/, never in opencode/.
#
# usage: rift/sync.sh [version]     version defaults to rift/upstream.json
# exit:  0 done, 2 a patch did not apply, 3 an overlay file collides with an upstream file
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
repository=$(python3 -c "import json;print(json.load(open('rift/upstream.json'))['repository'])")
version=${1:-$(python3 -c "import json;print(json.load(open('rift/upstream.json'))['version'])")}

git fetch --quiet --no-tags "$repository" "+refs/tags/$version:refs/rift/upstream/$version" 2>/dev/null ||
  git fetch --quiet --no-tags "$repository" "$version"
ref=refs/rift/upstream/$version
git rev-parse -q --verify "$ref" >/dev/null || ref=FETCH_HEAD

rm -rf opencode
mkdir opencode
git archive "$ref" | tar -x -C opencode

# RIFT is a terminal program: drop what the terminal binary does not build or ship (see rift/prune.txt).
grep -vE '^\s*(#|$)' rift/prune.txt | while read -r path; do rm -rf "opencode/$path"; done

# A file both sides own would silently lose upstream's version, so it has to be a patch instead.
collisions=$(cd rift/overlay && find . -type f | sed 's#^\./##' | while read -r file; do
  [ ! -e "$root/opencode/$file" ] || echo "$file"
done)
if [ -n "$collisions" ]; then
  echo "upstream now has files RIFT adds:" >&2
  echo "$collisions" >&2
  exit 3
fi
cp -R rift/overlay/. opencode/

# --3way needs the index to agree with the tree being patched, so it runs on a scratch index.
export GIT_INDEX_FILE="$root/.git-rift-sync-index"
[ -d "$root/.git" ] || GIT_INDEX_FILE="$(git rev-parse --git-dir)/rift-sync-index"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
git read-tree --empty
git add -f opencode >/dev/null
failed=()
for patch in rift/patches/*.patch; do
  if ! git apply --3way --whitespace=nowarn "$patch" 2>/tmp/rift-patch.err; then
    failed+=("$patch")
    cat /tmp/rift-patch.err >&2
  fi
done
if [ ${#failed[@]} -gt 0 ]; then
  printf 'did not apply: %s\n' "${failed[@]}" >&2
  exit 2
fi

python3 - "$version" <<'PY'
import json, sys
path = "rift/upstream.json"
data = json.load(open(path))
data["version"] = sys.argv[1]
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
echo "opencode/ is $version plus RIFT"
