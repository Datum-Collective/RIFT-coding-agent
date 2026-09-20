# Changelog

Release notes for every RIFT version, newest first. Full notes and downloads: https://github.com/Datum-Collective/RIFT-coding-agent/releases

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

