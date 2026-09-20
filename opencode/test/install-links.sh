#!/bin/bash
# Checks what the install script does about making `rift` reachable: link it into a PATH directory
# when it can, never overwrite or shadow anything, and fall back to the shell config otherwise.
#
# Every scenario gets its own throwaway HOME and a PATH that contains none of the real user
# directories, so running this cannot touch the machine it runs on. The "binary" is a stub script,
# so no build is needed.
#
#   bash opencode/test/install-links.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
BIN="$S/stub-rift"
printf '#!/bin/sh\necho 0.0.0-test\n' > "$BIN"
chmod +x "$BIN"
pass=0; fail=0
ok()  { echo "   PASS  $1"; pass=$((pass+1)); }
bad() { echo "   FAIL  $1"; fail=$((fail+1)); }
newenv() { T=$S/lt/$1; rm -rf "$T"; mkdir -p "$T/home/.local/bin" "$T/other" "$T/home/.rift"; touch "$T/home/.zshrc"; }
inst() { # extra PATH prefix, then installer args
  local pathv=$1; shift
  env -i HOME="$T/home" SHELL=/bin/zsh PATH="$pathv" RIFT_INSTALL_DIR="$T/home/.rift/bin" \
    /bin/bash "$REPO/install" --binary "$BIN" "$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
}

echo "A. ~/.local/bin is on PATH and writable -> rift works at once, no shell-config edit"
newenv A; out=$(inst "$T/home/.local/bin:/usr/bin:/bin")
[ -L "$T/home/.local/bin/rift" ] && ok "rift linked" || bad "rift not linked"
[ "$(readlink "$T/home/.local/bin/rift")" = "$T/home/.rift/bin/rift" ] && ok "link targets the installed binary" || bad "wrong link target"
[ -L "$T/home/.local/bin/opencode" ] && ok "opencode linked (nothing else claims that name)" || bad "opencode not linked"
[ ! -s "$T/home/.zshrc" ] && ok "shell config untouched" || bad "shell config was edited"
echo "$out" | grep -q "source " && bad "still tells you to reload" || ok "no reload instruction needed"
v=$(env -i HOME="$T/home" PATH="$T/home/.local/bin:/usr/bin:/bin" rift --version 2>&1 | tail -1); [ -n "$v" ] && [ "${v#*not found}" = "$v" ] && ok "fresh process finds rift immediately: $v" || bad "rift not runnable: $v"

echo "B. an 'opencode' already exists elsewhere on PATH -> never shadowed"
newenv B; printf '#!/bin/sh\necho upstream\n' > "$T/other/opencode"; chmod +x "$T/other/opencode"
out=$(inst "$T/home/.local/bin:$T/other:/usr/bin:/bin")
[ -L "$T/home/.local/bin/rift" ] && ok "rift still linked" || bad "rift not linked"
[ ! -e "$T/home/.local/bin/opencode" ] && ok "opencode NOT linked" || bad "shadowed the existing opencode"
echo "$out" | grep -q "Left opencode alone" && ok "said so" || bad "silent about skipping"
r=$(env -i HOME="$T/home" PATH="$T/home/.local/bin:$T/other:/usr/bin:/bin" opencode 2>&1); [ "$r" = "upstream" ] && ok "the existing opencode still runs" || bad "opencode now resolves to: $r"

echo "C. re-running is idempotent (an old window, or rift upgrade)"
inst "$T/home/.local/bin:$T/other:/usr/bin:/bin" >/dev/null; [ -L "$T/home/.local/bin/rift" ] && ok "still linked after a second run" || bad "link lost"
[ "$(readlink "$T/home/.local/bin/rift")" = "$T/home/.rift/bin/rift" ] && ok "same target" || bad "target changed"

echo "D. no suitable directory on PATH -> falls back to the shell config, and says to reload"
newenv D; out=$(inst "/usr/bin:/bin")
grep -q "rift/bin\|\.rift" "$T/home/.zshrc" && ok "PATH line written to .zshrc" || bad "no fallback edit"
echo "$out" | grep -q "source ~/.zshrc" && ok "reload hint shown" || bad "no reload hint"
[ ! -e "$T/home/.local/bin/rift" ] && ok "no link created" || bad "linked into a dir that is not on PATH"

echo "E. a different 'rift' already occupies the name -> never overwritten"
newenv E; printf '#!/bin/sh\necho other-rift\n' > "$T/home/.local/bin/rift"; chmod +x "$T/home/.local/bin/rift"
out=$(inst "$T/home/.local/bin:/usr/bin:/bin")
[ "$(env -i PATH="$T/home/.local/bin:/usr/bin:/bin" rift)" = "other-rift" ] && ok "the other rift is intact" || bad "overwrote someone else's rift"
echo "$out" | grep -q "Left rift alone" && ok "said so" || bad "silent"
grep -q "\.rift" "$T/home/.zshrc" && ok "fell back to the shell config" || bad "left rift unreachable"

echo "F. --no-modify-path -> no links, no shell-config edit"
newenv F; inst "$T/home/.local/bin:/usr/bin:/bin" --no-modify-path >/dev/null
[ ! -e "$T/home/.local/bin/rift" ] && [ ! -s "$T/home/.zshrc" ] && ok "environment untouched" || bad "modified the environment"

echo; echo "RESULT: $pass passed, $fail failed"; [ "$fail" = 0 ]
