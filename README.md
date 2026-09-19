<div align="center">

```
         ▄
█▀▀█ ▀██▀ █▀▀▀ ████
█▀▀▄  ██  █▀▀   ██
▀  ▀ ▀██▀ ▀     ██
```

# RIFT — an open-source AI coding agent for your terminal

**An AI coding agent that runs your tests instead of telling you they passed.**

[![Install](https://img.shields.io/badge/install-one%20command-2563eb)](#install)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-555555)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-555555)](opencode/LICENSE)

[Install](#install) · [Why RIFT](#why-rift-is-different) · [Features](#features) · [Docs](opencode/packages/web/src/content/docs/) · [FAQ](#faq)

</div>

---

RIFT is a free, open-source **AI coding agent** that lives in your terminal. It reads your
codebase, plans a change, edits files, and then — this is the part most coding agents skip —
**runs your project's own tests, typechecker and linter and shows you the real output**.

Most AI code assistants end a task by telling you it worked. RIFT ends a task by proving it, or
by telling you plainly that it could not. It also compares what it _said_ it did against the
actual `git diff`, and flags any claim the diff does not support.

It works with Claude, GPT, Gemini, Llama, and dozens of other models through a single CLI, runs
on macOS, Linux and Windows, and is MIT licensed.

## Install

**macOS, Linux, WSL, Git Bash**

```bash
curl -fsSL https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install.ps1 | iex
```

Open a new terminal, then point it at a project:

```bash
cd your-project
rift
```

No Node, no Python, no build step — the installer downloads a single self-contained binary
(~34 MB) from [Releases](https://github.com/shiv207/RIFT-coding-agent/releases). `opencode`
starts it too, so either command works.

<details>
<summary><b>Pin a version, change the install directory, uninstall</b></summary>

```bash
# install a specific release
curl -fsSL https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install | bash -s -- --version 0.1.0

# install somewhere other than ~/.rift/bin
RIFT_INSTALL_DIR=/usr/local/bin curl -fsSL .../install | bash

# leave shell config files alone
curl -fsSL .../install | bash -s -- --no-modify-path
```

```powershell
# irm | iex takes no arguments, so pin a version like this
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/shiv207/RIFT-coding-agent/main/opencode/install.ps1))) -Version 0.1.0
```

Update with `rift upgrade`. Remove with `rift uninstall`.

**macOS note:** binaries downloaded through a _browser_ are quarantined by Gatekeeper because
these builds are not notarized. Clear it with
`xattr -dr com.apple.quarantine ~/.rift/bin/rift`. Installing with the `curl` command above
avoids this entirely.

</details>

## Why RIFT is different

Coding agents are good at writing code and bad at knowing whether it works. Two failure modes
show up constantly: an agent that is confidently wrong, and a refactor that quietly breaks
something it never checked. RIFT is built around closing that gap.

### It verifies its own work

When the agent finishes editing, RIFT runs the checks your project already has — `test`,
`typecheck`, `lint`, `go test`, `cargo check`, `pytest` — and puts the real results in front of
you:

```
VERIFICATION ─────────────────────────────────────────
  ✓ bun run typecheck                              1.2s
  ✗ bun test                                     failed
  ○ bun run lint                      permission denied
  ⚠ summary does not match the diff (1)
```

A check that could not run says so. It is never counted as a pass.

### It checks its own summary against the diff

A second model compares what the agent claimed it did against the actual changes, and flags
anything the diff does not support:

```
⚠ Summary does not match the diff (1):
- Claimed: added exponential backoff
  Actually: the diff only adds a fixed 200ms delay
```

### It can open the page and look

For UI work, RIFT drives a real browser — navigate, click, type, screenshot — and reports the
**console errors a screenshot would never show**. A page that renders perfectly while throwing
on every render is caught, not shipped.

### The task is the interface, not the chat log

Instead of an endless transcript, the screen shows the state of the work: the plan, what's
running, what changed, and whether it held up.

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
```

Dozens of tool calls collapse into the handful of states worth reading. The full transcript is
one keystroke away.

## Features

- **Verification layer** — runs your real tests, typecheck and lint after every change set
- **Summary vs diff** — a second model flags claims the diff does not support
- **Vibe Mode** — a strong model plans and reviews each step, a cheaper model does the work, so
  you get good decisions without paying frontier prices for every edit
- **Browser control** — navigate, click, type, screenshot, and capture console errors
- **Mission Control** — every session on one board, ordered so whatever needs you is on top
- **Any model** — Claude, GPT, Gemini, Llama, Mistral, local models, and more through one CLI
- **Permissions** — approve or deny shell commands, edits and network access, per project
- **LSP + MCP** — language-server awareness and Model Context Protocol servers
- **Subagents, skills and plugins** — extend it without forking it
- **Terminal-native** — a fast TUI that works over SSH, in tmux, and on a 80-column window

## Usage

```bash
rift                      # start in the current directory
rift /path/to/project     # start somewhere else
rift run "fix the failing test"   # non-interactive, for scripts and CI
rift --continue           # resume the last session
```

Inside the TUI:

| Key         | Action                                        |
| ----------- | --------------------------------------------- |
| `<leader>v` | Switch between the task view and the full log |
| `<leader>o` | Open Mission Control                          |
| `<leader>d` | Review the diff                               |
| `ctrl+p`    | Command palette                               |
| `tab`       | Switch agent                                  |

## Configuration

Config lives in `rift.json` in your project, or `~/.config/rift/rift.json` globally.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-5",
  "verify": true,
  "verify_browser_url": "http://localhost:3000",
  "plannerModel": "anthropic/claude-opus-5",
  "executorModel": "anthropic/claude-haiku-4-5-20251001"
}
```

Coming from OpenCode? Your existing `opencode.json`, auth and sessions keep working — RIFT reads
both names and leaves your old directory in place.

See the [configuration reference](opencode/packages/web/src/content/docs/config.mdx) for every
option.

## FAQ

### Is RIFT free and open source?

Yes. MIT licensed, and the installer pulls prebuilt binaries straight from GitHub Releases.
Bring your own model API key, or use one of the free models included.

### How is this different from Claude Code, Cursor or Copilot?

Those are excellent at generating code. RIFT's focus is the step after: proving the change
actually works by running your project's own checks and showing you the raw output, rather than
reporting success. It is also terminal-first and open source, so you can read exactly what it
runs on your machine.

### Which AI models does RIFT support?

Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, Mistral, DeepSeek, local models via
Ollama, and many more — anything reachable through the provider list, configured per project or
per agent.

### Does it work on Windows?

Yes, natively via the PowerShell installer, and through WSL or Git Bash.

### Does my code get sent anywhere?

Only to the model provider you configure, the same as any other AI coding tool. RIFT itself has
no server. Shell commands, file edits and network access go through a permission system you
control.

### What is RIFT built on?

It is a fork of [OpenCode](https://github.com/anomalyco/opencode), rebuilt around a task-centred
interface and a verification layer.

## Building from source

You do not need this to use RIFT — the installer downloads a prebuilt binary.

```bash
git clone https://github.com/shiv207/RIFT-coding-agent.git
cd RIFT-coding-agent/opencode
bun install          # requires bun 1.3.14
bun run dev
```

Cut a release by pushing a tag — `git tag v0.1.0 && git push origin v0.1.0` — and the
[release workflow](.github/workflows/release.yml) builds all twelve platform targets.

## License

MIT. See [LICENSE](opencode/LICENSE). RIFT is a fork of
[OpenCode](https://github.com/anomalyco/opencode), also MIT.
