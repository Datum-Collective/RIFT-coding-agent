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
import { RiftReceipt } from "@opencode/core/plugin/rift-verify/receipt"
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
      ? [{ decision: item.metadata.decision, text: item.text ?? "", verdict: item.metadata.verdict }]
      : []
  })

/** Notices RIFT left without waking the model: shown to the user, read by the model on its next turn. */
const parked = (sessions: Session.Interface, sessionID: Session.ID) =>
  sessions.inbox(sessionID).pipe(
    Effect.map((items) =>
      items.flatMap((item) =>
        item.type === "synthetic" && item.payload.metadata?.source === "rift-verify"
          ? [{ decision: item.payload.metadata.decision, verdict: item.payload.metadata.verdict, text: item.payload.text, description: item.payload.description }]
          : [],
      ),
    ),
  )

const storage = KV.Service.use((kv) => Effect.succeed(PluginHost.storage(kv, RiftVerifyPlugin.ID)))

const prompt = (sessions: Session.Interface, sessionID: Session.ID, text: string) =>
  sessions.prompt({ sessionID, text }).pipe(Effect.andThen(sessions.wait(sessionID)))

/** Polls `read` until `done` holds, for work RIFT finishes after the call that started it returns. */
const until = <A, E, R>(read: () => Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const value = yield* read()
      if (done(value) || attempt >= 600) return value
      yield* Effect.sleep("50 millis")
    }
  })

const stored = (key: string) => storage.pipe(Effect.flatMap((store) => store.get(key)))
const receipts = (sessionID: string) => stored(`receipts:${sessionID}`).pipe(Effect.map((value) => value as unknown as RiftReceipt.Sealed[]))
// Checks run in a private copy of the project, so evidence that one ran is written outside it.
const outside = (dir: string, name: string) => path.join(dir, "..", `${path.basename(dir)}-${name}`)

describe("rift contract", () => {
  it.live("a check that was already failing goes back to the model, framed as not its doing, until it is fixed", () =>
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
      expect(reports(messages)[0]?.text).toContain("already failing before your change")
      expect(yield* stored(`run:${session.id}:change`)).toMatchObject({
        round: 1,
        run: { phase: "done", verdict: "verified", stages: [{ command: "bun run test", status: "passed" }] },
      })
      expect((yield* receipts(session.id)).map((receipt) => receipt.verdict)).toEqual(["failing", "verified"])
    }),
  )

  it.live("a check the change broke goes back as the change's fault", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("grep -q 1 a.ts")
      yield* serve((_, turn) => {
        write("a.ts", turn === 1 ? "export const a = 2\n" : "export const a = 1\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      const found = reports(yield* sessions.messages({ sessionID: session.id, order: "asc" }))
      expect(found.map((report) => [report.decision, report.verdict])).toEqual([["fix", "regressed"]])
      expect(found[0]?.text).toContain("new, not failing at the start of this prompt")
      expect(found[0]?.text).toContain("These checks failed on your changes")
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
      const marker = outside((yield* tmpdirScoped()).path, "ran")
      const { session, sessions } = yield* project(`touch ${marker}`)
      yield* serve((_, turn) => TestLLM.text("Answer", `answer-${turn}`))
      yield* prompt(sessions, session.id, "A question")
      expect(existsSync(marker)).toBe(false)
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

  it.live("a denied check does not run, and is shown as not run without waking the model", () =>
    Effect.gen(function* () {
      const marker = outside((yield* tmpdirScoped()).path, "ran")
      const { session, sessions, write } = yield* project(`touch ${marker}`, [{ action: "shell", resource: "*", effect: "deny" }])
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        write("a.ts", "export const a = 2\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      expect(existsSync(marker)).toBe(false)
      const found = yield* until(() => parked(sessions, session.id), (items) => items.length > 0)
      expect(found.map((report) => [report.decision, report.verdict])).toEqual([["report", "unproven"]])
      expect(found[0]?.description).toContain("Verify: unproven")
      expect(found[0]?.text).toContain("NOT RUN: bun run test (denied by a permission rule)")
      expect(found[0]?.text).not.toContain("ok:")
      expect(calls).toBe(1)
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
  const commitTest = (dir: string, name: string, text: string) => {
    writeFileSync(path.join(dir, name), text)
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "add test"], { cwd: dir })
  }

  it.live("skipping a test to get a pass is caught, sent back, and written to a receipt chain that audits", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("true")
      const original = "it('works', () => { expect(1).toBe(1) })\n"
      commitTest(dir, "a.test.ts", original)
      yield* serve((_, turn) => {
        if (turn === 1) {
          write("a.ts", "export const a = 2\n")
          write("a.test.ts", "it.skip('works', () => { expect(1).toBe(1) })\n")
        }
        if (turn === 2) write("a.test.ts", original)
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      const messages = yield* sessions.messages({ sessionID: session.id, order: "asc" })
      const found = reports(messages)
      // The checks themselves passed ("true"), and it was still sent back.
      expect(found.map((report) => report.decision)).toEqual(["fix"])
      expect(found[0]?.text).toContain("ok: bun run test")
      expect(found[0]?.text).toContain("BLOCKED: a.test.ts")
      expect(found[0]?.text).toContain("[skipped-test]")
      expect(found[0]?.text).toContain("Restore them")
      const chain = yield* receipts(session.id)
      expect(chain.map((receipt) => receipt.verdict)).toEqual(["tampered", "verified"])
      expect(RiftReceipt.audit(chain)).toBeUndefined()
      expect(chain[1]?.prev).toBe(chain[0]?.digest)
    }),
  )

  it.live("an honest edit to a test is not flagged, and still gets a verified receipt", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("true")
      commitTest(dir, "a.test.ts", "it('works', () => { expect(1).toBe(1) })\n")
      yield* serve((_, turn) => {
        write("a.test.ts", "it('works', () => { expect(2).toBe(2) })\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Update the test")
      expect(reports(yield* sessions.messages({ sessionID: session.id, order: "asc" }))).toEqual([])
      const chain = (yield* receipts(session.id)) as (RiftReceipt.ReceiptV2 & { digest: string })[]
      expect(chain.map((receipt) => [receipt.verdict, receipt.integrity])).toEqual([["verified", []]])
      expect(chain[0]?.inputs.files.map((file) => file.path)).toEqual(["a.test.ts"])
    }),
  )

})
