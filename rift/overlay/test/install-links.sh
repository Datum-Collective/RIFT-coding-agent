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
    /bin/bash "$REPO/install" --binary "$BIN" "$@" </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
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

# ---- the closing banner -----------------------------------------------------------------------------
# The art is full of backslashes, which several tools quietly rewrite, so it is compared against a
# reference file rather than trusted. That file is also what the PowerShell installer is checked against.
ART="$REPO/test/datum-art.txt"
sed -n '/^# ---- the closing banner/,/^print_banner$/p' "$REPO/install" | sed '$d' > "$S/banner-fn.sh"
banner() { # columns; stdout is a pipe, so this is the uncoloured text
  # stdin is closed so bash cannot mistake this for a remote shell, which makes it read ~/.bashrc
  env -i PATH="/usr/bin:/bin" RIFT_BANNER_COLS="$1" /bin/bash -c 'source "$1"; print_banner' _ "$S/banner-fn.sh" </dev/null
}
nonblank() { grep -v '^[[:space:]]*$' || true; }
trim() { sed 's/[[:space:]]*$//'; }

echo "L. the banner reproduces the Datum Software art exactly, at every width"
[ -s "$S/banner-fn.sh" ] && ok "banner code found in the installer" || bad "could not extract the banner code"
if [ "$(banner 120 | nonblank | trim)" = "$(trim < "$ART")" ]; then ok "side by side at 120 columns is identical to the reference"; else bad "wide layout differs from the reference"; fi
awk '{ l = substr($0, 1, 39); sub(/ +$/, "", l); print l }' "$ART" > "$S/left.txt"
awk '{ r = substr($0, 44); sub(/ +$/, "", r); print r }' "$ART" > "$S/right.txt"
if [ "$(banner 80 | nonblank | trim)" = "$(cat "$S/left.txt" "$S/right.txt")" ]; then ok "stacked at 80 columns is identical (Datum, then software)"; else bad "stacked layout differs from the reference"; fi
[ "$(banner 40 | nonblank)" = "Datum Software" ] && ok "a very narrow terminal falls back to a plain line" || bad "narrow fallback wrong"
banner 120 | awk '{ if (length($0) > 120) exit 1 }' && ok "never wider than the terminal" || bad "wider than a 120 column terminal"
banner 80 | awk '{ if (length($0) > 80) exit 1 }' && ok "never wider than an 80 column terminal" || bad "wider than an 80 column terminal"

if command -v python3 >/dev/null 2>&1; then
cat > "$S/banner_pty.py" <<'PYEOF'
import fcntl, os, pty, re, select, struct, sys, termios, time
S, cols, colorterm, no_color = sys.argv[1:5]
env = {"PATH": "/usr/bin:/bin", "TERM": "xterm-256color", "HOME": "/tmp"}
if colorterm != "-": env["COLORTERM"] = colorterm
if no_color == "1": env["NO_COLOR"] = "1"
pid, fd = pty.fork()
if pid == 0:
    # A real window size, set before anything runs, so width detection is exercised for real.
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 30, int(cols), 0, 0))
    os.execve("/bin/bash", ["bash", "-c", 'source "$1"; print_banner', "_", S + "/banner-fn.sh"], env)
buf = b""; t0 = time.time()
while time.time() - t0 < 15:
    r, _, _ = select.select([fd], [], [], 0.3)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        buf += d
sys.stdout.write(buf.decode("utf8", "ignore").replace("\r", ""))
PYEOF
  tty_banner() { python3 "$S/banner_pty.py" "$S" "$@"; }
  strip_sgr() { sed $'s/\x1b\\[[0-9;]*m//g'; }

  echo "N. the layout follows the terminal's real width, measured the way the installer measures it"
  # $(tput cols) reports 80 on any terminal because stdout is a pipe there, so a fake width in the
  # tests hid that a wide window would always get the narrow layout. These use a real window size.
  both_words() { grep -q '/_____/ \\__,_/ \\__/ \\__,_/ /_/ /_/ /_/  */____/ \\____//_/' <<<"$1"; }
  o=$(tty_banner 137 truecolor 0 | strip_sgr)
  if both_words "$o"; then ok "a 137 column terminal gets the side-by-side layout"; else bad "137 columns still got the stacked layout"; fi
  o=$(tty_banner 79 truecolor 0 | strip_sgr)
  if both_words "$o"; then bad "a 79 column terminal was given the 98 column layout"; else ok "a 79 column terminal gets the stacked layout"; fi
  # The stripe rule is measured separately: awk counts its 3 byte glyphs as 3 columns each.
  echo "$o" | nonblank | grep -v '━' | awk '{ if (length($0) > 79) exit 1 }' && ok "and nothing in it is wider than the window" || bad "stacked layout overflows 79 columns"
  o=$(tty_banner 50 truecolor 0 | strip_sgr)
  [ "$(echo "$o" | nonblank | grep -vc '━')" = "1" ] && echo "$o" | grep -q "Datum Software" && ok "a 50 column terminal gets the one line fallback" || bad "narrow fallback wrong"

  echo "M. colour changes how it looks, never what it says"
  o=$(tty_banner 120 truecolor 0)
  echo "$o" | grep -q $'\x1b\\[38;2;' && ok "true colour terminals get exact 24-bit colour" || bad "no 24-bit colour"
  [ "$(echo "$o" | strip_sgr | grep -v '━' | nonblank | trim)" = "$(trim < "$ART")" ] && ok "coloured text is identical to the reference" || bad "colouring altered the text"
  # the first and last stripe of the palette are Apple green and Apple blue
  echo "$o" | grep -q '38;2;97;187;70' && ok "starts at Apple green" || bad "green missing"
  o=$(tty_banner 120 - 0)
  echo "$o" | grep -q $'\x1b\\[38;5;' && ok "a 256 colour terminal (macOS Terminal.app) gets 256 colour codes" || bad "no 256 colour codes"
  echo "$o" | grep -q $'\x1b\\[38;2;' && bad "sent 24-bit colour to a terminal that may not support it" || ok "and no 24-bit codes, which Terminal.app would misdraw"
  o=$(tty_banner 120 truecolor 1)
  echo "$o" | grep -q $'\x1b\\[' && bad "NO_COLOR ignored" || ok "NO_COLOR is respected"
  [ "$(echo "$o" | nonblank | trim)" = "$(trim < "$ART")" ] && ok "and still prints the art" || bad "art missing under NO_COLOR"
fi

echo; echo "RESULT: $pass passed, $fail failed"; [ "$fail" = 0 ]
