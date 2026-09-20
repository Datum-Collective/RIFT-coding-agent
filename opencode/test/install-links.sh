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

# ---- the shell the installer opens when it could not link rift into a PATH directory ----------------
# These need a real terminal, so they drive the installer through a pseudo-terminal, piped in the
# way `curl | bash` pipes it. Anything that opens a shell where it should not would be worse than
# the problem it solves, so the cases where it must stay closed matter as much as the one where it opens.
cat > "$S/drive_installer.py" <<'PYEOF'
import os, pty, re, select, shutil, shlex, signal, sys, time
repo, tmp, stub, extra, pathv, keys = sys.argv[1:7]
shutil.rmtree(tmp, ignore_errors=True)
home = tmp + "/home"; os.makedirs(home + "/.local/bin")
for rc in (".zshrc", ".bashrc"): open(home + "/" + rc, "w").close()
env = {"HOME": home, "SHELL": "/bin/bash", "TERM": "xterm", "PATH": pathv.replace("@HOME", home)}
for pair in filter(None, extra.split(",")):
    k, v = pair.split("="); env[k] = v
pid, fd = pty.fork()
if pid == 0:
    # Paths are quoted because a checkout directory can contain spaces.
    os.execve("/bin/bash", ["bash", "-c", f"cat {shlex.quote(repo + '/install')} | bash -s -- --binary {shlex.quote(stub)}"], env)
buf = b""; t0 = time.time(); sent = False; timed_out = False
while time.time() - t0 < 40:
    r, _, _ = select.select([fd], [], [], 0.3)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        buf += d
    if keys and not sent and b"Opening a new shell" in buf:
        time.sleep(1); os.write(fd, keys.encode()); sent = True
    try:
        done, _ = os.waitpid(pid, os.WNOHANG)
        if done: break
    except ChildProcessError: break
else:
    os.kill(pid, signal.SIGKILL); timed_out = True
out = re.sub(rb"\x1b\[[0-9;?]*[a-zA-Z]", b"", buf).decode("utf8", "ignore").replace("\r", "")
print("TIMEOUT" if timed_out else "DONE")
print(out)
PYEOF
if command -v python3 >/dev/null 2>&1; then
  # "It did not open a shell" is also true when the driver crashed and printed nothing, so every
  # negative case first requires proof that the installer really ran to its final banner.
  completed() { echo "$1" | head -1 | grep -q DONE && echo "$1" | grep -q "RIFT includes free models"; }
  ptyrun() { python3 "$S/drive_installer.py" "$REPO" "$S/pty" "$BIN" "$@"; }
  KEYS=$'command -v rift; rift --version; exit\n'

  echo "G. interactive terminal, nothing to link into -> opens a shell that already has rift"
  o=$(ptyrun "" "/usr/bin:/bin" "$KEYS")
  echo "$o" | grep -q "Opening a new shell" && ok "announced it" || bad "did not open a shell"
  echo "$o" | grep -q "0.0.0-test" && ok "rift runs inside it" || bad "rift not usable in the new shell"
  echo "$o" | head -1 | grep -q DONE && ok "returns when you exit" || bad "hung"
  echo "$o" | grep -q "First, load rift" && bad "also told you to source, which is redundant" || ok "no redundant reload instruction"

  echo "H. RIFT_NO_SHELL=1 -> never opens a shell, prints the reload command instead"
  o=$(ptyrun "RIFT_NO_SHELL=1" "/usr/bin:/bin" "")
  completed "$o" && ok "installer ran to completion" || bad "installer did not complete: $(echo "$o" | head -3 | tr '\n' ' ')"
  echo "$o" | grep -q "Opening a new shell" && bad "opened a shell despite the opt-out" || ok "stayed closed"
  echo "$o" | grep -q "source ~/.bashrc" && ok "printed the reload command" || bad "no reload command"

  echo "I. CI=1 -> never opens a shell"
  o=$(ptyrun "CI=1" "/usr/bin:/bin" "")
  completed "$o" && ok "installer ran to completion" || bad "installer did not complete: $(echo "$o" | head -3 | tr '\n' ' ')"
  echo "$o" | grep -q "Opening a new shell" && bad "opened a shell in CI" || ok "stayed closed"

  echo "J. rift was linked into a PATH directory -> nothing to reload, no shell"
  o=$(ptyrun "" "@HOME/.local/bin:/usr/bin:/bin" "")
  completed "$o" && ok "installer ran to completion" || bad "installer did not complete: $(echo "$o" | head -3 | tr '\n' ' ')"
  echo "$o" | grep -q "Opening a new shell" && bad "opened a shell it did not need" || ok "stayed closed"
  echo "$o" | grep -q "Linked rift" && ok "linked instead" || bad "did not link"

  echo "K. a shell we do not know how to start -> falls back to the reload command"
  o=$(ptyrun "SHELL=/bin/sh" "/usr/bin:/bin" "")
  completed "$o" && ok "installer ran to completion" || bad "installer did not complete: $(echo "$o" | head -3 | tr '\n' ' ')"
  echo "$o" | grep -q "Opening a new shell" && bad "opened an unrecognised shell" || ok "stayed closed"
else
  echo "(python3 not found: skipping the terminal scenarios)"
fi

echo; echo "RESULT: $pass passed, $fail failed"; [ "$fail" = 0 ]
