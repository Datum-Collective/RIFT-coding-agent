import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Command } from "../../src/command"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Command.node))

it.instance("/remotion ships as a built-in command, and /video still runs it", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const remotion = yield* commands.get("remotion")
    expect(remotion?.source).toBe("command")
    expect(remotion?.hints).toContain("$ARGUMENTS")
    const template = yield* Effect.promise(async () => String(await remotion?.template))
    // It drives Remotion's official skills and installs them when a project has none.
    expect(template).toContain("remotion-best-practices")
    expect(template).toContain("rift remotion setup")
    const video = yield* commands.get("video")
    expect(yield* Effect.promise(async () => String(await video?.template))).toBe(template)
  }),
)
