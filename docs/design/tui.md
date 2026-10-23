# RIFT terminal UI

The design system for the TUI. Read this before changing a screen; every component follows it.

Direction (revision 2): Claude's polish (a blacked-out canvas, soft surfaces, rounded cards, generous
spacing, quiet typography) over OpenCode's depth (a rich side panel, framed composer, floating
dialogs, status everywhere it helps), with RIFT's own identity: the block-art logo, the azure accent
that comes from it, the glyph gutter and the verification-first content.

## Principles

1. **The transcript is the product.** One column of work, read top to bottom like a terminal
   session. Panels, chrome and decoration only appear when they carry information.
2. **Soft surfaces.** A warm canvas, and one step up from it a panel tone for the things you work
   in: the composer, tool output, the side panel, dialogs. Rounded corners on cards, never on rules.
   Content still looks like what a developer reads all day: a prompt, a `$ command`, a diff.
3. **One glyph per kind of thing.** The left gutter tells you what a line is before you read it.
4. **Color is information.** Neutrals for text, one accent for "this is RIFT / this is focused",
   and status colors only for status. If removing a color loses no meaning, remove it.
5. **Dense, not cramped.** One line per tool call, blank lines only between turns and blocks.
   Long output collapses with a count; nothing scrolls the transcript sideways.
6. **Keyboard first, mouse welcome.** Every action has a key; clicks expand and select.
7. **An opening that says RIFT.** The home screen leads with the logo and tagline, then the
   composer at the logo's width, then a welcome card (recent sessions, keys worth knowing) and a tip.

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
 ╭──────────────────────────────────────────────╮
 │ ◆ RIFT 0.1.13   the coding agent that checks… │   ← intro card, scrolls with the transcript
 │   Coder 1   ~/proj:master                     │
 ╰──────────────────────────────────────────────╯

 ❯ fix the flaky retry test                          ← user turn, on a panel band

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
 ╭──────────────────────────────────────────────────╮
 │ ❯ _                                              │ ← composer card
 │   build Coder 1 Fake                             │
 ╰──────────────────────────────────────────────────╯
  ~/proj   ● 2 MCP          18.6K (9%)  ctrl+p commands  ? keys
```

- Gutter: 1 column margin, then a 2-column glyph cell, then content. Answers and tool detail
  indent to column 3.
- Transcript text wraps at the terminal width minus the rail. Prose is not re-centred.
- Side panel: 42 columns on the right on the panel tone, shown at 130+ columns and toggled with
  the sidebar key. Below that width it opens as an overlay.

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

Tokens, dark / light: true black and neutral greys, with the logo's azure as the accent.

| Token | Dark | Light | Use |
|---|---|---|---|
| background | `#000000` | `#FFFFFF` | the canvas |
| backgroundPanel | `#0C0C0C` | `#F7F7F7` | composer, tool bodies, user turns, side panel, dialogs |
| backgroundElement | `#181818` | `#EDEDED` | hover, the selected row |
| borderSubtle | `#262626` | `#E2E2E2` | card frames, rules, empty bar track |
| border (faint ink) | `#4D4D4D` | `#A3A3A3` | gutters, done glyphs, metadata |
| text | `#EDEDED` | `#171717` | body |
| textMuted | `#8F8F8F` | `#666666` | secondary text, targets, hints |
| primary / accent | `#7C83FF` | `#3D46F2` | RIFT, focus, `❯ $ ± ≡`, selection, progress |
| success | `#6BCB8B` | `#1A7F37` | done, additions |
| warning | `#E5B567` | `#9A6700` | needs you, retries, approval frames |
| error | `#F07178` | `#CF222E` | failures, deletions |

Syntax colors stay in the same family: keywords indigo, strings green, numbers amber, types cyan,
comments faint italic.

## Type

The terminal font, three weights by attribute only: **bold** for the one thing on a line that
matters (verb, title, selected row), normal for content, muted for metadata. Italic only for
reasoning. No all-caps headings; section labels are lowercase muted words (`plan 2/3`).

## Components

- **Composer**: a rounded card on the panel tone; its frame turns accent while the agent works.
  Inside: `❯` and the input, then agent and model. Under it: directory, MCP and approval status,
  context and cost, and the palette and `?` keys. While busy, an activity line above the card shows
  the spinner, elapsed time, retry countdown and `esc to stop`.
- **Dialogs** (every picker): a rounded card floating in the upper middle over a lightly dimmed
  backdrop. The selected row gets the element tone, an accent `›` and bold text. Categories are
  bold muted labels.
- **Approvals**: a rounded card framed in amber (questions in accent, rejections in red): what is
  asked, then numbered choices; keys 1 to 3 or arrows and enter.
- **Side panel**: 42 columns on the panel tone. Session title over a rule, then sections with a
  bold title and a quiet count: status, Context (bar, tokens, cost), Plan (progress bar, steps),
  Changes, Checks, Graph, MCP, LSP; RIFT and the version at the foot.
- **Autocomplete** (`/`, `@`): the same list style as sheets, directly above the composer.
- **Shortcut sheet**: `?` on an empty composer; three columns (compose, session, navigate).
- **Toasts**: a small rounded card at the top right, framed in the status colour.

## Motion

One spinner (braille, 80 ms, accent) for anything in progress. No pulses, gradients or
background animation. Respect the `animations_enabled` setting: a static `…` when off.

One exception: after ten seconds with no key, paste or mouse movement, the home screen (and only
the home screen) fades in a koi pond behind the interface (`component/idle-koi`, `koi/`). It is
painted only into cells the interface left empty, so nothing is ever covered, and the first input
removes it on the next frame. The one thing it takes over is the banner: each time the pond
appears, the logo breaks into pieces that become the koi, and while the pond is out the banner
draws nothing (it keeps its size, so nothing moves); the next frame after any input it is back
exactly as it was. The pond uses the palette above and nothing else: the canvas, neutral greys and
the azure accent. It stops while the terminal is in the background. It follows the
`animations_enabled` setting and also `RIFT_NO_ANIMATION` (the spinner and the prompt follow the
setting only).
