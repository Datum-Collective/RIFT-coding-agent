# Debloat baseline (Phase 0)

Measured 2026-10-10 on macOS arm64, commit dcdc8c25 (branch `rift-share`), before any deletion.

## How it was built and measured

```
cd opencode && bun install                      # 4677 packages, 302 s
export PATH=/tmp/bun14/bun-darwin-aarch64:$PATH # bun 1.3.14 (repo requires ^1.3.14; the machine had 1.3.12)
cd packages/opencode && bun run build --single --skip-install   # 35 s wall, includes the embedded web UI build
```

Binary: `packages/opencode/dist/opencode-darwin-arm64/bin/opencode`.

- Startup: `/usr/bin/time -l <bin> --version`, 5 runs.
- `rift run`: `<bin> run "reply with pong"` in an empty directory, default free model (space-bunny-free), 4 runs.
- Prompt tokens: `bun script/prompt-tokens.ts opencode/space-bunny-free --tokenizer <gpt-tokenizer>`.
  A local server stands in for Zen, the CLI sends its first request to it, and the request body is
  split into system prompt and tool definitions. Token counts use the o200k tokenizer
  (`gpt-tokenizer`), which approximates but is not the tokenizer of the free models.
  The environment is hermetic (empty HOME), so only the built-in skill is present.
- Bundle: `bun script/bundle-report.ts 30` (bundles like build.ts, with `metafile`, no compile).

## Numbers

| Metric | Baseline |
|---|---|
| Binary size | 146,138,210 bytes (146.1 MB) |
| `--version` wall time | 0.46, 0.46, 0.46, 0.48 s warm (2.90 s first, cold) |
| `--version` max RSS | 196.1 to 197.2 MB |
| `rift run "reply with pong"` | 4.14, 4.18, 3.86, 4.62 s (dominated by the model) |
| Fixed prompt tokens, first request | 8,724 (system 2,148 + tools 6,576) |
| Tools sent | 14 |
| Skill tool description | 144 tokens with the one built-in skill (the plan measured 5.8k with a populated skills directory) |
| Shipped TS/TSX, no tests (all packages) | about 474k lines; terminal product (opencode, core, tui, llm, codemode, schema, server, protocol, plugin, sdk) about 175k |

Tool token cost, largest first: bash 1247, task 825, graphwrite 817, todowrite 614, browser 431,
edit 432, websearch 421, read 415, webfetch 294, grep 280, glob 242, write 224, browser_open 190, skill 144.

System prompt: 10,109 chars, the `default.txt` family prompt, with the RIFT graphwrite paragraph and
the skills block appended.

## 30 largest bundle inputs (bytes in output)

See `bundle-baseline.txt` for the list and the by-package grouping. Notable:

- `core/src/models-dev.ts` 4.8 MB: the embedded models.dev snapshot.
- `typescript.js` 3.6 MB, and about 3 MB of prettier plugins: formatter/LSP support.
- `src/video/template.txt` 0.95 MB: the packed video engine.
- `venice-ai-sdk-provider` 349 KB, `fast-check` 156 KB (a test library in the bundle), `mime-db` 150 KB.
- Not in this JS accounting: the embedded web UI assets, which `build.ts` adds as files.

## Guards added

- `test/guard/request-snapshot.test.ts`: runs the real CLI against a local server and snapshots
  method, path, header names and values, and body shape for: an `opencode/*` free model
  (openai-compatible), an `opencode/*` free model on the Responses transport, an `opencode/*` model
  with a key on the Anthropic transport, and a custom `openai-compatible` provider. Also asserts
  that without a key a paid `opencode/*` model is not sent at all.
- `test/guard/smoke.network.test.ts`: opt-in (`RIFT_NETWORK_SMOKE=1`, optional `RIFT_SMOKE_BIN`),
  sends one real "reply with pong" and expects `pong`. Passed against the baseline binary.

Notes on the guard: the live free models are currently openai-compatible (and one Responses
model); the catalogue's Anthropic free models are marked deprecated and filtered, so the Anthropic
transport is covered with a keyed paid model. The `user-agent` value includes the AI SDK package
version (`ai-sdk/provider-utils/x.y.z`), so a dependency change that moves that version fails the
snapshot on purpose.
