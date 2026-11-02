#!/usr/bin/env bash
# Turns packages/cli/dist/cli-<target> into the release archives the RIFT installers download:
#   rift-<target>.tar.gz (linux, macOS) or rift-<target>.zip (windows), holding `rift`, LICENSE and the notices.
#
# usage: script/rift-package.sh [--upload <tag>]     run from opencode/, after packages/cli/script/build.ts
# env:   GH_REPO for --upload
set -euo pipefail
cd "$(dirname "$0")/.."
dist=packages/cli/dist
out=$dist/release
tag=""
[ "${1:-}" = "--upload" ] && tag=${2:?--upload needs a tag}

rm -rf "$out"
mkdir -p "$out"
assets=()
for dir in "$dist"/cli-*/; do
  target=$(basename "$dir"); target=${target#cli-}
  bin=$dir/bin/opencode
  [ -f "$bin" ] || bin=$dir/bin/opencode.exe
  [ -f "$bin" ] || { echo "no binary in $dir" >&2; exit 1; }
  stage=$(mktemp -d)
  case $target in
    windows-*) cp "$bin" "$stage/rift.exe"; branded=rift.exe ;;
    *) cp "$bin" "$stage/rift"; branded=rift ;;
  esac
  cp ../LICENSE "$stage/LICENSE"
  cp ../THIRD_PARTY_NOTICES.md "$stage/THIRD_PARTY_NOTICES.md"
  # The installers expect a tarball on Linux only; macOS and Windows get a zip.
  case $target in
    linux-*)
      # macOS tar stores extended attributes as a separate ._rift entry that GNU tar extracts as a stray file.
      (cd "$stage" && COPYFILE_DISABLE=1 tar -czf "$OLDPWD/$out/rift-$target.tar.gz" "$branded" LICENSE THIRD_PARTY_NOTICES.md)
      assets+=("$out/rift-$target.tar.gz") ;;
    *)
      (cd "$stage" && zip -qr "$OLDPWD/$out/rift-$target.zip" "$branded" LICENSE THIRD_PARTY_NOTICES.md)
      assets+=("$out/rift-$target.zip") ;;
  esac
  rm -rf "$stage"
done
(cd "$out" && shasum -a 256 rift-* > SHA256SUMS)
assets+=("$out/SHA256SUMS")
printf '%s\n' "${assets[@]}"
# Upload what was produced; a shell glob would fail the whole step when a partial build matched nothing.
[ -z "$tag" ] || gh release upload "$tag" "${assets[@]}" --clobber --repo "${GH_REPO:?GH_REPO is required}"
