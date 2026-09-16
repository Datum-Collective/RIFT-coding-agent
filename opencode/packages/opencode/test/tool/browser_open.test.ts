import { describe, expect } from "bun:test"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { Command } from "effect/unstable/process/ChildProcess"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { BrowserOpenTool } from "../../src/tool/browser_open"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

const spawned: { command: string; args: readonly string[] }[] = []

function mockSpawner() {
  const spawner = ChildProcessSpawner.make((command: Command) => {
    const std = command._tag === "StandardCommand" ? command : undefined
    if (std) spawned.push({ command: std.command, args: std.args })
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

const spawnerNode = makeGlobalNode({
  service: ChildProcessSpawner.ChildProcessSpawner,
  layer: mockSpawner(),
  deps: [],
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Truncate.node, Agent.node, CrossSpawnSpawner.node]), [
    [CrossSpawnSpawner.node, spawnerNode],
  ]),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const exec = Effect.fn("BrowserOpenToolTest.exec")(function* (args: Tool.InferParameters<typeof BrowserOpenTool>) {
  const info = yield* BrowserOpenTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

describe("tool.browser_open", () => {
  it.effect("registers with the browser_open id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* BrowserOpenTool
        expect(info.id).toBe("browser_open")
      }),
    ),
  )

  it.effect("opens https urls with the platform launcher", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        spawned.length = 0
        const result = yield* exec({ url: "https://example.com" })
        expect(result.output).toBe("Opened https://example.com in the default browser.")
        expect(spawned.length).toBe(1)
        if (process.platform === "darwin") {
          expect(spawned[0]).toEqual({ command: "open", args: ["https://example.com"] })
        } else if (process.platform === "win32") {
          expect(spawned[0]).toEqual({ command: "cmd", args: ["/c", "start", "", "https://example.com"] })
        } else {
          expect(spawned[0]).toEqual({ command: "xdg-open", args: ["https://example.com"] })
        }
      }),
    ),
  )

  it.effect("upgrades http urls to https", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        spawned.length = 0
        const result = yield* exec({ url: "http://example.com" })
        expect(result.output).toBe("Opened https://example.com in the default browser.")
        expect(spawned).toEqual([
          {
            command: process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open",
            args:
              process.platform === "win32"
                ? ["/c", "start", "", "https://example.com"]
                : ["https://example.com"],
          },
        ])
      }),
    ),
  )

  it.effect("rejects non-http urls without spawning", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        spawned.length = 0
        const exit = yield* exec({ url: "ftp://example.com" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("URL must start with http:// or https://")
        }
        expect(spawned.length).toBe(0)
      }),
    ),
  )
})
