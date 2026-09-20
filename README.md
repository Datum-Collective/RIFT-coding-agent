<p align="center">
  <img src="assets/banner.svg" alt="RIFT" width="576">
</p>

<p align="center"><b>The open-source AI coding agent that runs your tests instead of telling you they passed.</b></p>

<p align="center">
  <a href="https://github.com/Datum-Collective/RIFT-coding-agent/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Datum-Collective/RIFT-coding-agent?style=flat-square"></a>
  <a href="opencode/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-555?style=flat-square">
  <a href="https://github.com/anomalyco/opencode"><img alt="Built on OpenCode" src="https://img.shields.io/badge/built%20on-OpenCode-8b5cf6?style=flat-square"></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#what-rift-adds">What RIFT adds</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="#credits">Credits</a>
</p>

---

# RIFT — an open-source AI coding agent for your terminal

RIFT is a free, MIT-licensed **AI coding agent** that lives in your terminal. It reads your
codebase, plans a change, edits files, and then — the part most coding agents skip — **runs your
project's own tests, typechecker and linter, and shows you the real output**.

Most AI code assistants finish a task by telling you it worked. RIFT finishes by proving it, or
by saying plainly that it could not. It also compares what it _said_ it did against the actual
`git diff` and flags any claim the diff does not support.

It works with Claude, GPT, Gemini, Llama and dozens of other models through one CLI, and runs on
macOS, Linux and Windows.

> **RIFT is a fork of [OpenCode](https://github.com/anomalyco/opencode)**, and most of the code
> here is theirs. See [Credits](#credits).

## Installation

**macOS, Linux, WSL, Git Bash**

```bash
curl -fsSL https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install.ps1 | iex
```

Open a new terminal, then point it at a project:

```bash
cd your-project
rift
```

No Node, no Python, no build step — the installer drops a single self-contained binary (46–63 MB, depending on your platform)
from [Releases](https://github.com/Datum-Collective/RIFT-coding-agent/releases). `opencode` starts it
too, so either command works.

<details>
<summary><b>Pin a version, change the install directory, uninstall</b></summary>

```bash
# a specific release
curl -fsSL https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install | bash -s -- --version 0.1.0

# somewhere other than ~/.rift/bin
RIFT_INSTALL_DIR=/usr/local/bin curl -fsSL .../install | bash

# leave shell config files alone
curl -fsSL .../install | bash -s -- --no-modify-path
```

```powershell
# irm | iex takes no arguments, so pin a version like this
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Datum-Collective/RIFT-coding-agent/main/opencode/install.ps1))) -Version 0.1.0
```

Update with `rift upgrade`, remove with `rift uninstall`.

**macOS:** a binary downloaded through a _browser_ is quarantined by Gatekeeper, because these
builds are not notarized. Clear it with `xattr -dr com.apple.quarantine ~/.rift/bin/rift`. The
`curl` command above avoids this entirely.

</details>

## What RIFT adds

Everything below is what RIFT builds on top of OpenCode.

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

A second model compares what the agent claimed against the actual changes:

```
⚠ Summary does not match the diff (1):
- Claimed: added exponential backoff
  Actually: the diff only adds a fixed 200ms delay
```

### It can open the page and look

For UI work, RIFT drives a real browser — navigate, click, type, screenshot — and reports the
**console errors a screenshot would never show**. A page that renders perfectly while throwing
on every render gets caught.

### The task is the interface, not the chat log

The screen shows the state of the work rather than an endless transcript:

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

Dozens of tool calls collapse into the few states worth reading; the full transcript is one
keystroke away.

### Vibe Mode

A strong model plans and reviews each step while a cheaper one does the work, so you get good
decisions without paying frontier prices for every edit.

### Mission Control

Every session on one board, ordered so whatever needs you is on top.

## Usage

```bash
rift                              # start in the current directory
rift /path/to/project             # start somewhere else
rift run "fix the failing test"   # non-interactive, for scripts and CI
rift --continue                   # resume the last session
```

| Key         | Action                                        |
| ----------- | --------------------------------------------- |
| `<leader>v` | Switch between the task view and the full log |
| `<leader>o` | Open Mission Control                          |
| `<leader>d` | Review the diff                               |
| `ctrl+p`    | Command palette                               |
| `tab`       | Switch agent                                  |

## Agents

RIFT inherits OpenCode's agents, switchable with `Tab`:

- **build** — full-access agent for development work
- **plan** — read-only agent for analysis and exploration
- **vibe** — planner and executor models working together, with a review gate between steps

A **general** subagent handles complex searches and multistep tasks; invoke it with `@general`.

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
both names and leaves your old directory where it is.

Full reference: [configuration docs](opencode/packages/web/src/content/docs/config.mdx).

## FAQ

### Is RIFT free and open source?

Yes — MIT licensed, with prebuilt binaries on GitHub Releases. Bring your own model API key, or
use one of the free models included.

### How is this different from Claude Code, Cursor or Copilot?

Those are excellent at generating code. RIFT's focus is the step after: proving the change works
by running your project's own checks and showing the raw output. It is terminal-first and open
source, so you can read exactly what it runs on your machine.

### Which AI models does RIFT support?

Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama, Mistral, DeepSeek, local models via
Ollama, and many more — configured per project or per agent.

### Does it work on Windows?

Yes, natively via the PowerShell installer, and through WSL or Git Bash.

### Does my code get sent anywhere?

Only to the model provider you configure, the same as any other AI coding tool. RIFT has no
server of its own. Shell commands, edits and network access go through a permission system you
control.

## Credits

**RIFT is a fork of [OpenCode](https://github.com/anomalyco/opencode) by
[Anomaly](https://github.com/anomalyco), and the overwhelming majority of this codebase is their
work.** The agent loop, provider layer, tool system, LSP and MCP integration, permissions, config
system and the TUI foundation are all OpenCode's. RIFT rebuilds the interface around tasks and
adds the verification layer described above.

OpenCode is MIT licensed, and so is RIFT. If you like what is here, a great deal of the credit
belongs upstream — [give them a star](https://github.com/anomalyco/opencode).

**RIFT is not affiliated with, endorsed by, or supported by the OpenCode team.** Please direct
issues with RIFT to [this repository](https://github.com/Datum-Collective/RIFT-coding-agent/issues), not
to them.

## Building from source

You do not need this to use RIFT — the installer downloads a prebuilt binary.

```bash
git clone https://github.com/Datum-Collective/RIFT-coding-agent.git
cd RIFT-coding-agent/opencode
bun install          # requires bun 1.3.14
bun run dev
```

Cut a release by pushing a tag — `git tag v0.1.0 && git push origin v0.1.0` — and the
[release workflow](.github/workflows/release.yml) builds all twelve platform targets.

## License

MIT — see [LICENSE](opencode/LICENSE). Copyright for the inherited code remains with the
OpenCode authors.
