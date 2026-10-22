# OpenCode Zen "API key has expired" in RIFT

Investigated 2026-10-21 at 18:39 IST. Key values are redacted throughout.

## Root cause

**The rift sessions the user is running were started before the shell fix, so they still have the expired `OPENCODE_API_KEY` in their environment.**

| PID | Started | TTY | Parent | `OPENCODE_API_KEY` |
|---|---|---|---|---|
| 22778 | 18:34:58 | ttys000 | zsh 12038 (18:07:23) under `/usr/bin/login` under **cmux.app** (3216) | present (`sk-7***`) |
| 23515 | 18:36:32 | ttys000 | same zsh 12038 | present (`sk-7***`) |

Evidence:
- `~/.zshrc` was last modified at 18:37:45 (`stat`), and the backup `~/.zshrc.bak-rift` at 18:34:24. Both processes started before 18:37:45.
- The parent zsh 12038's initial environment (`ps eww`) has no key, and neither does cmux. So zsh exported the key itself when it sourced the old `~/.zshrc` line 33 at 18:07. Any new `rift` started from that tab inherits it, because the trailing `unset` only runs in shells that source the new file.
- The terminal is **cmux** (`/Applications/cmux.app`), not Ghostty. No Ghostty process was running.
- With the key present, `packages/opencode/src/provider/provider.ts:185-205` sets `hasKey` and skips the `apiKey: "public"` fallback. The core plugin path does the same at `packages/core/src/plugin/provider/opencode.ts:176-178`. The expired key is then sent to Zen.
- The error text does not appear anywhere in the repo source; the closest local message is in `packages/opencode/src/provider/error.ts:61`. So the text comes from the Zen server, which is rejecting the expired key. It is not rejecting `"public"`. The `env -u OPENCODE_API_KEY` test returned `ok`.

## Sources checked (clean unless noted)

- **Shell files:** `~/.zshrc:33` is commented out and `~/.zshrc:42` runs `unset OPENCODE_API_KEY`. `~/.zshenv`, `~/.zprofile`, `~/.zlogin`, `~/.profile`, `~/.bash_profile`, `~/.bashrc`, `/etc/zshenv`, `/etc/zprofile`, `/etc/zshrc` and `/etc/profile` have no matches for OPENCODE, RIFT_, launchctl, direnv, mise, asdf, `op run` or dotenv.
- **launchd:** `launchctl getenv OPENCODE_API_KEY` is now empty. `launchctl print gui/501` and `user/501` show no OPENCODE or RIFT_ entries. `~/Library/LaunchAgents` has no plists containing OPENCODE or setenv. `~/.MacOSX/environment.plist` and `/etc/launchd.conf` do not exist. The earlier non-empty `getenv` result no longer reproduces.
- **Ghostty config:** there is no `env` or OPENCODE entry in `~/.config/ghostty/config`, and Ghostty is not the terminal in use anyway. Only the presence of `~/.config/cmux/cmux.json` was confirmed; it was not searched for OPENCODE. Check it if the key comes back in brand-new tabs.
- **Project `.env`, `.envrc`, `.mise` and `.tool-versions` files:** none in `RIFT-Code`, `~/Developer` or `~`. The only files mentioning `OPENCODE_API_KEY` are source and test fixtures.
- **Auth and config:**
  - `~/.local/share/opencode/auth.json` holds only google, anthropic and openrouter (no `opencode`). `rift-new/auth.json` and `rift/auth.json` do not exist.
  - `~/.config/opencode/opencode.jsonc` has no `apiKey`.
- **SQLite `~/.local/share/opencode/opencode.db` (read-only):** the `account`, `account_state`, `control_account` and `credential` tables all have 0 rows.
- **RIFT_\* mapping:** `packages/core/src/brand.ts:12,89` (`adoptEnv`) copies `RIFT_*` variables onto their `OPENCODE_*` names. No `RIFT_*KEY` variable was found in any process or shell file.
- **Binaries:** `~/.local/bin/rift` is a symlink to `~/.rift/bin/rift`, so they are the same file (identical sha). Watch out for `/opt/homebrew/bin/opencode`: it is upstream opencode, not RIFT.
- **Desktop app:** not running. `packages/desktop/src/main/shell-env.ts:75-90` probes `$SHELL -il`, falling back to `-l`, so it sources `~/.zshrc` and now gets the unset. However, `mergeShellEnv` (`shell-env.ts:95-99`) spreads the app's own `env` over the shell result. If RIFT.app is launched from a terminal that still has the key (for example `open` run from tab ttys000), the key wins.
- **The Bash tool session used for this investigation** also inherited the key from the cmux tab, which shows the same stale-env problem.

## Fix (ordered)

1. Quit both stale rift sessions (PIDs 22778 and 23515 in cmux tab ttys000): exit them normally, or `kill 22778 23515`.
2. In that tab, run `unset OPENCODE_API_KEY`, or better, close it and open a new cmux tab or window. New login shells source the fixed `~/.zshrc`.
3. Optional hardening: remove the commented-out line 33 from `~/.zshrc` so the key value no longer sits on disk. Revoke the key in the OpenCode Console. Delete `~/.zshrc.bak-rift`, which still contains the key.
4. If you use RIFT.app, quit it fully and relaunch it from Finder or the Dock, not from an old terminal.

Verify:
```sh
env | grep -c '^OPENCODE_API_KEY='                        # expect 0
for p in $(pgrep -x rift); do ps eww -p $p | grep -c OPENCODE_API_KEY=; done   # expect all 0
rift run -m opencode/big-pickle "reply with just: ok"     # expect: ok
```
Only free models should be listed for `opencode/*`. If paid ones are listed, a key is still being picked up.

## Would a code change make this robust? Yes

1. **Clearer error naming the key source.** In the `opencode` loader at `packages/opencode/src/provider/provider.ts:185-205`, record which source made `ok` true: the env var name, `auth.json`, or `config provider.opencode.options.apiKey`. Then append it to 401 messages in `packages/opencode/src/provider/error.ts` (around line 61), for example "key came from env OPENCODE_API_KEY (set in the shell that launched rift)". Do the same for `packages/core/src/plugin/provider/opencode.ts:176`.
2. **Fallback to `public` on an expired key.** When the source is the env var and Zen returns 401 or "expired", retry once with `apiKey: "public"` for free models (cost.input === 0) and log a warning. Keep this opt-in or limit it to free models, so users who intend to use paid models are not silently downgraded.
3. **Desktop app:** consider letting the login-shell env override the inherited app env for `OPENCODE_API_KEY`, or reversing the merge order in `mergeShellEnv` (`packages/desktop/src/main/shell-env.ts:95`), so a stale parent env does not beat the user's current shell config.
