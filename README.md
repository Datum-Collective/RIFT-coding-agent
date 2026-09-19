<div align="center">

```
         ▄
█▀▀█ ▀██▀ █▀▀▀ ████
█▀▀▄  ██  █▀▀   ██
▀  ▀ ▀██▀ ▀     ██
```

**A terminal-native control plane for AI software development.**

</div>

---

## Install

**macOS, Linux, WSL, Git Bash**

```bash
curl -fsSL https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install.ps1 | iex
```

Open a new terminal, then:

```bash
cd your-project
rift
```

`opencode` starts it too, so either command works.

<details>
<summary>Pinning a version, choosing a directory, uninstalling</summary>

```bash
# a specific release
curl -fsSL https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install | bash -s -- --version 0.1.0

# somewhere other than ~/.rift/bin
RIFT_INSTALL_DIR=/usr/local/bin curl -fsSL .../install | bash

# leave shell config alone
curl -fsSL .../install | bash -s -- --no-modify-path
```

```powershell
# irm | iex cannot take arguments, so pin a version like this
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install.ps1))) -Version 0.1.0
```

Update with `rift upgrade`, remove with `rift uninstall`.

</details>

<details>
<summary>Manual download</summary>

Grab an archive from [Releases](https://github.com/shiv207/RIFT-coding-agent/releases) and put the
binary on your PATH.

On macOS, a file downloaded through a **browser** is quarantined by Gatekeeper and will refuse to
run, because these builds are not notarized. Clear it with:

```bash
xattr -dr com.apple.quarantine ~/.rift/bin/rift
```

Installing with the `curl` command above avoids this entirely — curl does not set the quarantine
attribute.

On Windows the binary is unsigned, so SmartScreen may warn on a browser download. The PowerShell
installer clears the download marker for you.

</details>

## What it is

RIFT is a fork of [OpenCode](https://github.com/anomalyco/opencode) built around one idea: **the
task, not the chat transcript, is the centre of the UI.** The session screen answers four
questions at a glance — what the agent is doing, what changed, whether it needs you, and whether
the work actually held up.

```
TASK ─────────────────────────────────────────────────
  Add retry logic to the API client
  ● executing · opus-5 → haiku-4.5 · 4 files +82 −11

PLAN ─────────────────────────────────────────────────
  ✓ 1. Add the retry helper                 src/retry.ts
  ● 2. Wire it into the client             src/client.ts
  ○ 3. Cover it with tests            test/retry.test.ts

EXECUTION ────────────────────────────────────────────
  ✓ Analyzing code                                 2.1s
  ✓ Editing 4 files                                8.4s
  ● Running tests

VERIFICATION ─────────────────────────────────────────
  ✓ bun run typecheck                              1.2s
  ✗ bun test                                     failed
  ⚠ summary does not match the diff (1)
```

Beyond the interface:

- **Verification.** After the agent edits files, RIFT runs your project's own tests, typecheck and
  lint and shows the real output — never the agent's claim that they passed. A check that could
  not run is reported as such, not counted as a pass.
- **Summary vs diff.** A second model compares what the agent said it did against the actual
  diff, and flags claims the diff does not support.
- **Vibe Mode.** A stronger model plans and reviews each step; a cheaper one does the work.
- **Browser control.** Drives a real page — navigate, click, type, screenshot — and surfaces the
  console errors a screenshot would never show.
- **Mission Control.** Every session on one board, ordered so whatever needs you is on top.

Press `<leader>v` to switch between the task view and the full log, `<leader>o` for Mission
Control, `<leader>d` to review the diff.

## Configuration

Config lives in `rift.json` (or `.rift/rift.json`) in your project, and
`~/.config/rift/rift.json` globally. An existing OpenCode install keeps working: the old
`opencode.json` names and `~/.config/opencode` are still read, and your auth and sessions are
found where they already are.

See [the docs](opencode/packages/web/src/content/docs/) for the full reference.

## Building from source

You do not need this to use RIFT — the installer downloads a prebuilt binary. To hack on it:

```bash
git clone https://github.com/shiv207/RIFT-coding-agent.git
cd RIFT-coding-agent/opencode
bun install          # needs bun 1.3.14; this pulls a large dependency tree
bun run dev          # run from source
```

Cut a release by pushing a tag: `git tag v0.1.0 && git push origin v0.1.0`. The
[release workflow](.github/workflows/release.yml) builds all twelve platform targets and uploads
the archives the installers read.
