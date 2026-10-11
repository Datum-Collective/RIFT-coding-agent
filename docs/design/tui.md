# RIFT terminal UI

The design system for the TUI. Read this before changing a screen; every component follows it.

## Principles

1. **The transcript is the product.** One column of work, read top to bottom like a terminal
   session. Panels, chrome and decoration only appear when they carry information.
2. **Terminal-native.** RIFT sits on the terminal's own background and font. No painted canvas,
   no rounded boxes around the input, no backdrop dimming. Things look like what a developer
   already reads all day: a prompt, a `$ command`, its output, a diff.
3. **One glyph per kind of thing.** The left gutter tells you what a line is before you read it.
4. **Color is information.** Neutrals for text, one accent for "this is RIFT / this is focused",
   and status colors only for status. If removing a color loses no meaning, remove it.
5. **Dense, not cramped.** One line per tool call, blank lines only between turns and blocks.
   Long output collapses with a count; nothing scrolls the transcript sideways.
6. **Keyboard first, mouse welcome.** Every action has a key; clicks expand and select.
7. **Same layout everywhere.** Home is an empty session: the composer never moves.

## Influences, and where RIFT differs

From Codex CLI: the transcript-first single column, the borderless composer at the bottom with
a one-line status under it, inline (not floating) pickers with a `›` cursor instead of a filled
bar, numbered approval choices, a `?` shortcut sheet, restraint with color.

RIFT's own: the gutter glyph system below; shell calls rendered as `$ command` with a ruled output
gutter; grouped exploration lines; a context rail (plan, engineering graph, changed files, MCP)
on wide terminals; the task view as a first-class view (`ctrl+l`); recent sessions on the home
screen; the indigo accent.

## Layout

```
 ◆ RIFT 0.1.13 · Coder 1 · ~/proj (master)          ← intro line, scrolls with the transcript

 ❯ fix the flaky retry test                          ← user turn

   ∴ thought 1.2s · look at the retry helper          ← reasoning, collapsed
   · Explored  read src/retry.ts · grep retry( (1)    ← grouped read/grep/glob/list
   $ bun test test/retry.test.ts                0.4s  ← shell
     │ 1 pass
   ± src/retry.ts  +1 −1                              ← edit, with a compact diff
   ☰ Plan 2/3                                          ← todo list
     ✓ Read retry helper
     ▸ Run the test suite

   Fixed. The backoff grew without a ceiling…        ← answer, markdown, indented 3
   ─ 1.6s · Coder 1                                   ← turn footer

 ⠙ Working 12s · esc to stop                          ← activity line (only while busy)
 ────────────────────────────────────────────────────
 ❯ _
   Build · Coder 1  Fake               ~/proj  master · 9% · ? keys
```

- Gutter: 1 column margin, then a 2-column glyph cell, then content. Answers and tool detail
  indent to column 3.
- Transcript text wraps at the terminal width minus the rail. Prose is not re-centred.
- Context rail: 36 columns on the right, separated by a faint `│`, shown at 140+ columns and
  toggled with the sidebar key. Below that width it opens as an overlay.

## Glyphs

| Line | Glyph | Color |
|---|---|---|
| User turn | `❯` | accent; text in strong fg |
| Reasoning | `∴` | faint, italic text |
| Tool, done | `·` | faint glyph, verb in fg, target in muted |
| Tool, running | spinner | accent |
| Tool, failed | `✕` | error |
| Tool, denied | `⊘` | muted, struck |
| Shell | `$` | accent; output under a faint `│` |
| File change | `±` | accent; `+n` success, `−n` error |
| Plan | `☰` | accent; items `✓` success, `▸` accent, `·` faint |
| Subagent | `⇢` | accent |
| Error | `✕` | error |
| Turn footer | `─` | faint |

## Color

Tokens, dark / light. Background is the terminal's own (transparent).

| Token | Dark | Light | Use |
|---|---|---|---|
| text | `#E4E5E9` | `#1F2328` | body |
| textMuted | `#8B909A` | `#656D76` | secondary text, targets, hints |
| border (faint) | `#3B3E45` | `#D0D7DE` | rules, gutters, done glyphs |
| primary / accent | `#7C83FF` | `#3D46F2` | RIFT, focus, `❯ $ ± ☰`, selection |
| success | `#6CCB8B` | `#1A7F37` | done, additions |
| warning | `#E5B567` | `#9A6700` | needs you, retries |
| error | `#F07178` | `#CF222E` | failures, deletions |
| backgroundPanel | `#16171C` | `#F6F8FA` | sheets (pickers, approvals), only where text must sit on a solid surface |
| backgroundElement | `#24262D` | `#EAEEF2` | hover, the composer's focused line |

Syntax colors stay in the same family: keywords indigo, strings green, numbers amber, types cyan,
comments faint italic.

## Type

The terminal font, three weights by attribute only: **bold** for the one thing on a line that
matters (verb, title, selected row), normal for content, muted for metadata. Italic only for
reasoning. No all-caps headings; section labels are lowercase muted words (`plan 2/3`).

## Components

- **Composer**: borderless. A faint full-width rule above it, `❯` prompt, one status line below
  (agent and model left; directory, branch, context and `? keys` right). While busy, an activity
  line sits above the rule with the spinner, elapsed time, retry countdown and `esc to stop`.
- **Sheets** (every picker and dialog): open at the bottom of the screen above the composer,
  full width, on `backgroundPanel`, with a top rule carrying the title and `esc`. The selected row
  is marked with an accent `›` and bold text, not a filled bar. Filter text is typed straight in.
- **Approvals**: a sheet with what is being asked (command, or diff), then numbered choices
  `1 allow once  2 always  3 reject`; keys 1 to 3 or arrows and enter.
- **Autocomplete** (`/`, `@`): the same list style as sheets, directly above the composer.
- **Shortcut sheet**: `?` on an empty composer; three columns (compose, session, navigate).
- **Toasts**: one line, top right, muted unless it is an error.

## Motion

One spinner (braille, 80 ms, accent) for anything in progress. No pulses, gradients or
background animation. Respect the `animations_enabled` setting: a static `…` when off.
