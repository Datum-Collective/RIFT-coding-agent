import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Command } from "../../src/command"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Command.node))

it.instance("/video ships as a built-in command, in any project, with no setup", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const video = yield* commands.get("video")
    expect(video?.source).toBe("command")
    expect(video?.hints).toContain("$ARGUMENTS")
    // The prompt sets the engine up itself when a project doesn't have one yet.
    expect(yield* Effect.promise(async () => String(await video?.template))).toContain("rift video init")
  }),
)
