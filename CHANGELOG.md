# Changelog

Release notes for RIFT versions, newest first. Entries for v0.1.10 to v0.1.13 are only on the Releases page. Full notes and downloads: https://github.com/Datum-Collective/RIFT-coding-agent/releases

## v0.2.3 (2026-10-23)

All we have to decide is what to do with the time that is given us. A koi pond for when you stop typing, and the RIFT logo turns into the koi. Full notes: https://github.com/Datum-Collective/RIFT-coding-agent/releases/tag/v0.2.3

### Added
- **A koi pond when you go quiet, and the RIFT logo turns into the koi.** After ten seconds without typing on the startup screen, a pond fades in behind it: koi drifting between lily pads, or two koi circling a pad, in RIFT's own colors (the canvas, neutral greys and the azure accent). The logo rests while the blue behind its letters fades away, then the chrome letters crumble into motes that stream to the koi and build them, and the koi swim off, all in about six seconds. The logo stays hidden while the pond is out. Everything else lies in front of the pond and is never covered. The first key or paste sends it all away on the next frame, with the logo back exactly as it was. The mouse does not: you can move it, click and scroll while the pond plays. It stops being redrawn while the terminal is in the background. Turn it off with `animations_enabled` (the "Disable animations" command) or `RIFT_NO_ANIMATION=1`. Adapted from [koi-screensaver](https://github.com/erikrjohansson/koi-screensaver) by Erik Johansson (MIT licence); see `THIRD_PARTY_NOTICES.md`.
- The release archives and npm packages now include `LICENSE` and `THIRD_PARTY_NOTICES.md`.

### Fixed
- `RIFT_NO_ANIMATION=0`, `false`, `no` or `off` no longer turn the `rift upgrade` animation off; any other value still does.

## v0.2.2 (2026-10-22)

May it be a light to you in dark places. The graph builds while the agent works, the prompt error is closed off for good, and updating is a walk to Mount Doom. Full notes: https://github.com/Datum-Collective/RIFT-coding-agent/releases/tag/v0.2.2

### Added
- **Updating is a journey.** On a real terminal, `rift upgrade` shows a marker walking from the Shire towards Mount Doom while it installs, then leaves a line from the books picked from the version. The TUI's update dialog shows the same line. Piped output, CI, `TERM=dumb` and `RIFT_NO_ANIMATION=1` keep the plain spinner.

### Fixed
- **The graph in the side panel builds while the agent works, not at the end.** It was drawn from the plan, the session diff and `graphwrite`. The diff only arrives after the turn, and models rarely write a plan or call `graphwrite`, so the panel stayed empty until the very end. It now shows the task the moment work starts, reads edited files from the edit tools as they run, credits each edit to the todo that was active when it happened, and groups files by directory when there is no plan. When the agent has declared a graph, edits it does not mention yet appear under it.
- **"Invalid prompt: The messages do not match the ModelMessage[] schema" can no longer come from RIFT's own markers.** v0.2.1 stopped one route for them into the provider options. The request is now also checked just before it goes to the SDK, and anything in `providerOptions` that is not a record is dropped, so a marker added later cannot end a session either. A TUI started before v0.2.1 keeps its old code until it is restarted.

## v0.2.1 (2026-10-22)

The road goes ever on. Fixes for the prompt error, the browser tool, Vibe Mode and `/share`. Full notes: https://github.com/Datum-Collective/RIFT-coding-agent/releases/tag/v0.2.1

### Fixed
- **Sessions no longer fail after their first compaction.** RIFT's own marker on the compaction summary was passed to the model as provider options, and the AI SDK rejected the whole request with "Invalid prompt: The messages do not match the ModelMessage[] schema". Only real provider metadata is forwarded now.
- **Vibe Mode can use tools on the last plan step.** The max-steps prompt ("tools are disabled") was injected there, so a one-step plan or a resumed session could never act. A step that is still unfinished after 40 turns now counts as failed and goes back to the planner, instead of looping.
- **The browser tool recovers.** DevTools runs over a pipe, so Chrome exits whenever RIFT does (including after a crash or `kill -9`), and every command times out after 30 seconds instead of hanging. A browser that died or a tab that crashed is replaced on the next call. Calls no longer overlap and report each other's page. `type` fills React-style inputs, `text` marks elements the page hides, `click` waits for a navigation it starts, `action: "steps"` is accepted, and a missing favicon is not reported as a console error.
- The engine worker logs unhandled errors instead of swallowing them.
- **`/share` links no longer get stuck on "still uploading".** The upload looked up every model the session had used and gave up if one had since been renamed or removed, leaving the gist as an empty placeholder. Missing models are skipped, and a share that fails to create is now logged with its cause.

### Added
- Fresh-context tester subagent, a lean compaction mode with a context cap, hedged requests for slow providers, stuck-loop detection, and verification that runs in the background while the agent works.
- `steps` on the browser tool, which runs a whole check (open, click, type, read, screenshot) in one call.

### Repository
- `main` requires a pull request and a passing `typecheck`. `docs/branching.md` describes `main`, `prototypes`, `datum-internal` and `external-fixes`.

## v0.2.0 (2026-10-13)

RIFT, lighter and faster. Full notes: https://github.com/Datum-Collective/RIFT-coding-agent/releases/tag/v0.2.0

### Faster and smaller
- The macOS arm64 binary went from 146 MB to 97 MB, `rift --version` from 0.46 s and 197 MB of memory to 0.03 s and 34 MB, and the prompt overhead on every request from 8,724 to 2,901 tokens.
- Commands load only when you run them, and provider data is prepared only for the providers you use.
- One compact system prompt replaces ten model-specific ones, tool descriptions are shorter, and skills are listed by name.
- The web UI, desktop app, console, Slack bot, ACP, stats, code mode, OpenTelemetry, 22 unused provider SDKs and a second interactive mode were removed from the binary.

### MCP
- Project `.mcp.json`, user `~/.rift/mcp.json` and the `mcp` key in `rift.json` are read in the usual `mcpServers` shape, with `${VAR}` and `${VAR:-default}`.
- A server from a project's `.mcp.json` waits for approval (once, always or deny), remembered per project.
- `rift mcp add`, `add-json`, `get`, `list` and `remove`, plus a `/mcp` panel. Servers start on first use, and with many tools RIFT sends only their names plus one search tool.

### Terminal UI
- A new default theme on a true black canvas, one line per tool call, a side panel with status, context use, plan, changes, checks, the engineering graph, MCP and LSP, and approvals you can answer with one key.

### Video
- `/remotion` (and `/video`) now runs on Remotion's official Agent Skills. `rift remotion setup`, `new` and `studio` manage the project. Skills from Claude Code plugins load in RIFT too.

### Changed
- Sessions open on the conversation, and `ctrl+l` switches to the task view.
- `rift --mini`, `rift run --interactive` and `rift video init` are gone.
- Providers that used to be bundled (xAI, Azure, Bedrock, Vertex and others) still work; RIFT installs their SDK on first use.

## v0.1.9 — One Key (2026-09-21)

One key to switch views.

### Changed
- **`ctrl+l` switches between the task view and the full chat.** No chord to time. `ctrl+o` and `ctrl+x` then `v` still work, and the hints and the switch message name `ctrl+l`.

Everything else is unchanged from v0.1.8. To update, run the install one-liner or accept the in-app prompt.

## v0.1.8 — Two Views (2026-09-20)

The task view is back as the default, and the full chat is one keypress away.

### Changed
- **Sessions open on the task view again:** what the agent is doing, the plan, what changed, and whether it needs you. It replaces the wall of chat, which was the point.
- **`ctrl+o` switches between the task view and the full chat.** `ctrl+x` then `v` still works. Switching tells you which view you are in and how to go back, and the task view always shows the shortcut. Your choice is remembered.

### Also in this release (since v0.1.6)
- `/brainrot` works from the home screen, and `rift --version` prints the RIFT release.
- The side panel shows the task: state, plan progress, changed files, checks.
- RIFT keeps checking for updates while it is open.

To update, run the install one-liner or accept the in-app prompt.


## v0.1.7 — Brain Rot (2026-09-20)

Brain Rot Mode, an updater that keeps looking, a side panel that shows the work, and a round of "why does it say that" fixes.

### New
- **Brain Rot Mode.** Type `/brainrot` (works on the home screen too) and replies turn into unhinged internet slang. Code, commit messages, commands and error text stay serious. Set `"brain_rot": true` in your config to start every session that way.
- **A side panel with a job.** It leads with what the agent is doing (working, waiting on you, checking, done), then the plan with progress, the files changed with +/- counts, and the checks that ran.
- **Updates that keep looking.** RIFT checks GitHub while it is open, not only at launch. When a release lands it asks: **Update now** or **Skip this version**. Patch releases install silently only if you set `autoupdate: true`.

### Fixed
- `rift --version` now prints the RIFT release (like `0.1.7`), not the OpenCode runtime it is built on. `rift debug info` prints both. The home screen and crash reports agree.
- Sessions open on the conversation, not the task summary. `ctrl+x` then `v` switches views, and your choice is remembered.
- Sessions the model can't name are titled from your first message, instead of "New session - <timestamp>".
- Gemini: when Google says how long to wait after a busy or quota error, RIFT now waits that long instead of retrying too early and giving up.
- `/brainrot` no longer shows "No matching items" on the home screen.

### Upgrading
Run the install one-liner, or, if you are on 0.1.6, accept the update prompt. From here on, the version shown in the terminal, the sidebar and this page are the same number.


## v0.1.3 — Landing (2026-09-20)

The installer now leaves you with a working `rift`, and RIFT can update itself. Windows fixes from v0.1.2 are included.

### Fixed (Linux & macOS)
- `rift` is on your PATH the moment the install finishes: linked into a directory already on PATH, or a shell opens with it ready. No more `command not found`.
- The installer no longer stalls for a minute on an unreachable download address.
- Tells you to reload your shell when needed, and never shadows an existing command.

### Fixed (Windows)
- RIFT and OpenCode runtime versions are tracked separately (thanks @danvraz).

### New
- **In-app updates.** RIFT checks GitHub on launch and asks: **Update now** or **Skip this version**. Patch releases install silently only with `autoupdate: true`.
- Datum retro-gradient banner closes the install.
- Sidebar and `rift debug info` show the RIFT release beside the runtime version.

Existing v0.1.1 installs: re-run the install one-liner once to move to v0.1.3.


## v0.1.6, v0.1.5, v0.1.4 (2026-09-20)

Brain Rot Mode (`/brainrot`), Gemini retry timing, session titles from your first message, and an updater that keeps checking while RIFT is open. Rolled into the v0.1.7 notes above.

## v0.1.1 — Bedrock (2026-09-20)

First release with working installers for macOS, Linux and Windows.

## Who built what

43 commits on `main` so far, excluding merges: **41 by shiv** (product direction, design and every feature request in this changelog, plus the commits) and 2 by dan (Windows runtime versioning). Claude wrote code under shiv's direction.

### shiv's commits by release

**unreleased** (1)
- docs: add a changelog covering v0.1.1 to v0.1.8

**v0.1.8** (1)
- feat(tui): sessions open on the task view again, with a one-key switch to the full chat

**v0.1.7** (5)
- fix(build): smoke test expects the RIFT release from --version
- fix(tui): open sessions on the conversation, not the task summary
- fix(tui): Brain Rot works from the home screen, and every screen shows the RIFT release
- fix: `rift --version` reports the RIFT release, not the OpenCode runtime
- feat(tui): a side panel that shows what the agent is doing

**v0.1.6** (1)
- feat(session): fallback to first message for title when model cannot name session

**v0.1.5** (1)
- test(tui): cover ctrl+x v leader for full-log toggle

**v0.1.4** (2)
- feat: keep checking for updates while running and don't re-offer the same release
- feat: brain rot mode and respect google RetryInfo on 429

**v0.1.3** (7)
- feat: ask before updating, and make the update prompt actually reach the user
- edging
- feat: finish the installers with a retro Apple gradient "Datum Software"
- feat: open a shell with rift ready when it cannot be linked into PATH
- feat: make rift reachable the moment the install finishes
- fix: stop the installer stalling for a minute on a dead download address
- fix: tell people to reload their shell after installing

**v0.1.1** (23)
- ci: prove the release before it ships, and refuse to ship half of it
- fix: fail loudly when a release has no build to download
- fix: point every install URL at the repo's new home
- fix: make a fresh clone installable, and clear the installer lint
- ci: harden the release workflow before the first tag
- docs: credit OpenCode properly and show the real banner
- docs: rewrite the README for people arriving cold from search
- feat: one-command install for macOS, Linux and Windows
- fix(tui): align the banner and the prompt on the home screen
- feat: real browser control, and browser checks in verification
- feat: rename the app to rift without stranding existing installs
- fix(tui): render the banner in the artwork's own palette
- feat(tui): rebuild the shell around a Codex/Claude-style surface
- fix: address code review findings in the control plane
- feat(tui): task-centred control plane and Mission Control
- keep building
- feat: check the agent's summary against the real diff
- fix: monorepo-aware verification, richer Vibe review context, portable tests
- feat: verification layer and Vibe Mode planner review
- chore: upload RIFT codebase with flattened opencode to RIFT-coding-agent
- cooking
- Replace entire codebase with Relay IDE project
- Initial commit

