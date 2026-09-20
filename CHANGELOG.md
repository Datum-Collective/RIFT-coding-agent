# Changelog

Release notes for every RIFT version, newest first. Full notes and downloads: https://github.com/Datum-Collective/RIFT-coding-agent/releases

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
