import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ForgeTool } from "../../src/tool/forge"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

function context(ask: (input: { permission: string; metadata: Record<string, unknown> }) => Effect.Effect<void>) {
  return {
    sessionID: SessionID.make("ses_forge-test"),
    messageID: MessageID.make("msg_forge-test"),
    callID: "call-1",
    agent: "forge",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask,
  }
}

describe("tool.forge", () => {
  it.instance("records a stage and points at the next one", () =>
    Effect.gen(function* () {
      const info = yield* ForgeTool
      const tool = yield* info.init()
      const asked: string[] = []
      const result = yield* tool.execute(
        { stage: "requirements", status: "done", summary: "4 requirements" },
        context((input) => Effect.sync(() => void asked.push(input.permission))),
      )
      expect(result.metadata).toMatchObject({ stage: "requirements", status: "done" })
      expect(result.output).toContain("Next stage: architecture")
      expect(asked).toEqual([])
    }),
  )

  it.instance("the gate asks the human and carries the evidence", () =>
    Effect.gen(function* () {
      const info = yield* ForgeTool
      const tool = yield* info.init()
      const asked: Array<{ permission: string; metadata: Record<string, unknown> }> = []
      const result = yield* tool.execute(
        { stage: "gate", status: "active", summary: "ready", items: [{ text: "bun test passed", status: "done" }] },
        context((input) => Effect.sync(() => void asked.push(input))),
      )
      expect(asked.map((item) => item.permission)).toEqual(["forge_gate"])
      expect(asked[0]?.metadata.items).toEqual([{ text: "bun test passed", status: "done" }])
      expect(result.metadata.approved).toBe(true)
    }),
  )

  it.instance("a gate rejected with feedback fails with that feedback", () =>
    Effect.gen(function* () {
      const info = yield* ForgeTool
      const tool = yield* info.init()
      const exit = yield* tool
        .execute(
          { stage: "gate", status: "active", summary: "ready" },
          context(() => Effect.die(new PermissionV1.CorrectedError({ feedback: "use postgres" }))),
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("use postgres")
    }),
  )
})
