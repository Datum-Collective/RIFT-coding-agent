/**
 * RIFT's contract with upstream. Each test drives a real session, on upstream's own runner and a scripted model, through
 * a real project and real commands. An upstream release that changes what RIFT relies on fails here, before it ships.
 */
import { describe, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect, Layer, Option } from "effect"
import { LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { PluginHost } from "@opencode/core/plugin/host"
import { RiftVerifyPlugin } from "@opencode/core/plugin/rift-verify"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Done", "done") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node, Job.node, KV.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(LanguageModel.make({ id: "rift", provider: "test", route: OpenAIChat.route }), {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              }),
            ),
        }),
      ),
    ]),
  ),
)

const model = Model.Ref.make({ id: Model.ID.make("rift"), providerID: Provider.ID.make("test") })
const allow = [{ action: "shell", resource: "*", effect: "allow" as const }]

function project(testScript: string, permission: readonly { action: string; resource: string; effect: "allow" | "deny" }[] = allow) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const write = (name: string, text: string) => writeFileSync(path.join(tmp.path, name), text)
    write("package.json", JSON.stringify({ name: "t", scripts: { test: testScript } }))
    write("bun.lock", "")
    write("a.ts", "export const a = 1\n")
    const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp.path })
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      agent: Agent.ID.make("build"),
      model,
      permissions: [...permission],
    })
    return { session, sessions, dir: tmp.path, write }
  })
}

function serve(respond: (request: LLMRequest, turn: number) => TestLLM.Response) {
  let turn = 0
  // Session titles go through the same model. Only a request offering tools is an agent turn.
  return TestLLM.Test.use((llm) =>
    llm.serve((request) => (request.tools.length === 0 ? TestLLM.text("Title", "title") : respond(request, ++turn))),
  )
}

const reports = (messages: readonly { type: string }[]) =>
  messages.flatMap((message) => {
    const item = message as { type: string; text?: string; metadata?: Record<string, unknown> }
    return item.type === "synthetic" && item.metadata?.source === "rift-verify"
      ? [{ decision: item.metadata.decision, text: item.text ?? "" }]
      : []
  })

const storage = KV.Service.use((kv) => Effect.succeed(PluginHost.storage(kv, RiftVerifyPlugin.ID)))

const prompt = (sessions: Session.Interface, sessionID: Session.ID, text: string) =>
  sessions.prompt({ sessionID, text }).pipe(Effect.andThen(sessions.wait(sessionID)))

describe("rift contract", () => {
  it.live("a failing check goes back to the model, which fixes it in the same execution", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("test -f fixed")
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        if (turn === 1) write("a.ts", "export const a = 2\n")
        if (turn === 2) write("fixed", "yes")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      const messages = yield* sessions.messages({ sessionID: session.id, order: "asc" })
      expect(calls).toBe(2)
      expect(reports(messages).map((report) => report.decision)).toEqual(["fix"])
      expect(reports(messages)[0]?.text).toContain("FAILED: bun run test")
      const stored = yield* storage.pipe(Effect.flatMap((store) => store.get(`session:${session.id}`)))
      expect(JSON.stringify(stored)).toContain("ok: bun run test")
    }),
  )

  it.live("passing checks cost no extra model call", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("true")
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        write("a.ts", "export const a = 2\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      expect(calls).toBe(1)
      expect(reports(yield* sessions.messages({ sessionID: session.id, order: "asc" }))).toEqual([])
    }),
  )

  it.live("a turn that edits nothing runs nothing", () =>
    Effect.gen(function* () {
      const { session, sessions, dir } = yield* project("touch ran")
      yield* serve((_, turn) => TestLLM.text("Answer", `answer-${turn}`))
      yield* prompt(sessions, session.id, "A question")
      expect(existsSync(path.join(dir, "ran"))).toBe(false)
    }),
  )

  it.live("an agent that keeps editing cannot loop past the cap", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("false")
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        write("a.ts", `export const a = ${turn + 1}\n`)
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      const messages = yield* sessions.messages({ sessionID: session.id, order: "asc" })
      expect(reports(messages).map((report) => report.decision)).toEqual(["fix", "fix", "fix", "give_up"])
      expect(reports(messages).at(-1)?.text).toContain("not proven")
      expect(calls).toBe(RiftVerifyPlugin.MAX_ROUNDS + 2)
    }),
  )

  it.live("a denied check does not run, and is reported as not run rather than passed", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("touch ran", [{ action: "shell", resource: "*", effect: "deny" }])
      yield* serve((_, turn) => {
        write("a.ts", "export const a = 2\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      expect(existsSync(path.join(dir, "ran"))).toBe(false)
      const stored = yield* storage.pipe(Effect.flatMap((store) => store.get(`session:${session.id}`)))
      expect(JSON.stringify(stored)).toContain("NOT RUN")
      expect(JSON.stringify(stored)).not.toContain("ok:")
    }),
  )

  it.live("graphwrite reaches the model, and proofs follow the code they tested", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("true")
      const log = path.join(dir, "..", `runs-${session.id}`)
      const nodes = [
        {
          id: "a",
          title: "a",
          status: "in_progress",
          dependencies: [],
          files: ["a.ts"],
          decisions: [],
          checks: [{ label: "a holds", command: `echo run >> ${log}` }],
        },
      ]
      const edits: Record<number, () => void> = {
        2: () => write("a.ts", "export const a = 2\n"),
        3: () => write("b.ts", "export const b = 1\n"),
        4: () => write("a.ts", "export const a = 3\n"),
      }
      const offered: string[] = []
      yield* serve((request, turn) => {
        offered.push(...request.tools.map((tool) => tool.name))
        edits[turn]?.()
        return turn === 1 ? TestLLM.toolCall("call-graph", "graphwrite", { nodes }) : TestLLM.text("Done", `done-${turn}`)
      })
      const runs = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0)
      yield* prompt(sessions, session.id, "Build a")
      expect(offered).toContain("graphwrite")
      expect(runs()).toBe(1)
      yield* prompt(sessions, session.id, "Unrelated edit")
      expect(runs()).toBe(1)
      yield* prompt(sessions, session.id, "Edit a again")
      expect(runs()).toBe(2)
      const stored = yield* storage.pipe(Effect.flatMap((store) => store.get(`graph:${session.id}`)))
      expect(Option.isOption(stored)).toBe(false)
      expect(JSON.stringify(stored)).toContain('"status":"passed"')
    }),
  )
})
