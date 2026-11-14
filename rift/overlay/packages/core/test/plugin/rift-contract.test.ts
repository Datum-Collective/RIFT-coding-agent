/**
 * RIFT's contract with upstream. Each test drives a real session, on upstream's own runner and a scripted model, through
 * a real project and real commands. An upstream release that changes what RIFT relies on fails here, before it ships.
 */
import { describe, expect, test } from "bun:test"
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
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
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
const ask = [{ action: "shell", resource: "*", effect: "ask" as const }]

function project(testScript: string, permission: readonly { action: string; resource: string; effect: "allow" | "deny" | "ask" }[] = allow) {
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
      // The verifier said it fails, the agent was sent back, and only the later passing run closes the dispute.
      expect(yield* stored(`disputes:${session.id}`)).toMatchObject([
        { check: "bun run test", status: "resolved", round: 1, claim: expect.stringContaining("fails"), resolution: expect.stringContaining("passed in a later run") },
      ])
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

  it.live("an edit outside the verified folder is recorded, so the sidebar can say it was not checked", () =>
    Effect.gen(function* () {
      const elsewhere = yield* tmpdirScoped()
      const target = path.join(elsewhere.path, "cart.ts")
      const { session, sessions } = yield* project("true", [...allow, { action: "*", resource: "*", effect: "allow" }])
      yield* serve((_, turn) => (turn === 1 ? TestLLM.toolCall("call-write", "write", { path: target, content: "export const x = 1\n" }) : TestLLM.text("Done", `done-${turn}`)))
      yield* prompt(sessions, session.id, "Write a file elsewhere")
      const found = yield* until(() => stored(`outside:${session.id}`), (value) => Array.isArray(value) && value.length > 0)
      expect(found).toEqual([target])
    }),
  )

  it.live("a turn that edited only outside the verified folder says nothing was checked, once", () =>
    Effect.gen(function* () {
      const elsewhere = yield* tmpdirScoped()
      const target = path.join(elsewhere.path, "cart.ts")
      const { session, sessions } = yield* project("true", [...allow, { action: "*", resource: "*", effect: "allow" }])
      yield* serve((_, turn) => (turn === 1 ? TestLLM.toolCall("call-write", "write", { path: target, content: "export const x = 1\n" }) : TestLLM.text("Done", `done-${turn}`)))
      yield* prompt(sessions, session.id, "Write a file elsewhere")
      const notices = yield* until(() => parked(sessions, session.id), (items) => items.some((item) => item.text.includes("outside")))
      const found = notices.filter((item) => item.text.includes("outside"))
      expect(found).toHaveLength(1)
      expect(found[0]?.verdict).toBe("unproven")
      expect(found[0]?.text).toContain(target)
      expect(found[0]?.text).toContain("No check ran on them")
      // A later prompt that edits nothing outside is not told about the old files again.
      yield* serve((_, turn) => TestLLM.text("Answer", `answer-${turn}`))
      yield* prompt(sessions, session.id, "A question")
      const transcript = yield* sessions.messages({ sessionID: session.id, order: "asc" })
      expect(transcript.filter((message) => message.type === "synthetic" && JSON.stringify(message).includes("edited outside it"))).toHaveLength(1)
      expect(yield* stored(`outside:${session.id}`)).toEqual([])
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

  it.live("an agent whose failure keeps changing cannot loop past the cap", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("echo $(date +%N | tr 0-9 a-j); false")
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
      expect(yield* stored(`disputes:${session.id}`)).toMatchObject([
        { check: "bun run test", status: "unresolved", round: 1, evidence: expect.stringContaining("exited with code 1"), resolution: `still failing after ${RiftVerifyPlugin.MAX_ROUNDS} fix rounds` },
      ])
    }),
  )

  it.live("a fix that leaves the failure exactly as it was is told so, and the loop stops after two of them", () =>
    Effect.gen(function* () {
      const { session, sessions, write } = yield* project("false")
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        write("a.ts", `export const a = ${turn + 1}\n`)
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* prompt(sessions, session.id, "Change a")
      const found = reports(yield* sessions.messages({ sessionID: session.id, order: "asc" }))
      expect(found.map((report) => report.decision)).toEqual(["fix", "fix", "give_up"])
      expect(found[0]?.text).toContain("which line of the output")
      expect(found[1]?.text).toContain("left this failure exactly as it was")
      expect(found[2]?.text).toContain("Stopped")
      // Two fixes, then the turn in which the agent tells the user the work is not proven.
      expect(calls).toBe(4)
      expect(yield* stored(`disputes:${session.id}`)).toMatchObject([{ status: "unresolved" }])
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

  const status = (dir: string) => execFileSync("git", ["status", "--porcelain=v1"], { cwd: dir, encoding: "utf8" })
  const at = (dir: string) => Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir) })))
  // The plugin asks the permission service of its project's location, so the test answers through the same one.
  const permissions = <A, E>(dir: string, use: (permission: Permission.Interface) => Effect.Effect<A, E>) =>
    Permission.Service.use(use).pipe(Effect.scoped, at(dir))
  const asked = (dir: string, sessionID: Session.ID) =>
    until(
      () => permissions(dir, (permission) => permission.forSession(sessionID)),
      (requests) => requests.length > 0,
    )
  const reply = (dir: string, requestID: Permission.Request["id"], answer: "once" | "reject") =>
    permissions(dir, (permission) => permission.reply({ requestID, reply: answer }))
  const finished = (sessionID: Session.ID) =>
    until(
      () => stored(`run:${sessionID}:project`).pipe(Effect.map((value) => (value as { run?: { phase?: string } } | undefined)?.run)),
      (run) => run?.phase === "done" || run?.phase === "cancelled",
    )
  const cart = (dir: string) => {
    commitTest(dir, "cart.ts", "export const total = (a: number, b: number) => a + b\n")
    commitTest(
      dir,
      "cart.test.ts",
      'import { expect, test } from "bun:test"\nimport { total } from "./cart"\ntest("cart", () => expect(total(1, 2)).toBe(3))\ntest("old", () => expect(1).toBe(2))\n',
    )
  }

  it.live("/verify separates what the change broke from what HEAD already broke, with no model call and git untouched", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("bun test", ask)
      cart(dir)
      write("cart.ts", "export const total = (a: number, b: number) => a - b\n")
      const before = status(dir)
      let calls = 0
      yield* serve((_, turn) => {
        calls = turn
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* sessions.command({ sessionID: session.id, command: "verify", text: "" })
      const requests = yield* asked(dir, session.id)
      expect(requests.map((request) => request.resources)).toEqual([["bun run test"]])
      yield* reply(dir, requests[0]!.id, "once")
      expect(yield* finished(session.id)).toMatchObject({
        phase: "done",
        verdict: "regressed",
        stages: [{ command: "bun run test", status: "failed", introduced: 1, preexisting: 1 }],
      })
      const notice = yield* until(() => parked(sessions, session.id), (items) => items.length > 0)
      expect(notice[0]?.description).toContain("Verify: regressed")
      expect(notice[0]?.description).toContain("1 new failure, 1 already failing at HEAD")
      expect(notice[0]?.text).toContain("new, not failing at HEAD: cart")
      expect(calls).toBe(0)
      expect(status(dir)).toBe(before)
      expect((yield* receipts(session.id)).map((receipt) => receipt.verdict)).toEqual(["regressed"])
    }),
  )

  const head = (dir: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()
  const message = (dir: string) => execFileSync("git", ["log", "-1", "--format=%B"], { cwd: dir, encoding: "utf8" })
  const withCoauthor = <A, E, R>(value: string | undefined, run: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const before = process.env.RIFT_COAUTHOR
        if (value === undefined) delete process.env.RIFT_COAUTHOR
        else process.env.RIFT_COAUTHOR = value
        return before
      }),
      () => run,
      (before) =>
        Effect.sync(() => {
          if (before === undefined) delete process.env.RIFT_COAUTHOR
          else process.env.RIFT_COAUTHOR = before
        }),
    )

  it.live("/ship refuses work nothing has verified, and commits nothing", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("true")
      write("a.ts", "export const a = 2\n")
      const before = head(dir)
      yield* sessions.command({ sessionID: session.id, command: "ship", text: "change a" })
      const notice = yield* until(() => parked(sessions, session.id), (items) => items.length > 0)
      expect(notice[0]?.text).toContain("Not shipped: nothing has been verified")
      expect(head(dir)).toBe(before)
    }),
  )

  it.live("/ship commits verified work with RIFT as co-author, and not a push", () =>
    withCoauthor(
      "RIFT <1234+rift@users.noreply.github.com>",
      Effect.gen(function* () {
        const { session, sessions, dir, write } = yield* project("true")
        write("a.ts", "export const a = 2\n")
        yield* sessions.command({ sessionID: session.id, command: "verify", text: "quick" })
        expect(yield* finished(session.id)).toMatchObject({ phase: "done", verdict: "verified" })
        const before = head(dir)
        yield* sessions.command({ sessionID: session.id, command: "ship", text: "change a" })
        yield* until(() => Effect.succeed(head(dir)), (value) => value !== before)
        expect(message(dir)).toContain("change a")
        expect(message(dir)).toContain("Co-Authored-By: RIFT <1234+rift@users.noreply.github.com>")
        expect(status(dir)).toBe("")
        const notice = yield* until(() => parked(sessions, session.id), (items) => items.some((item) => item.description?.startsWith("Ship: committed")))
        expect(notice.at(-1)?.text).toContain("not pushed")
      }),
    ),
  )

  it.live("/ship without an identity commits but says RIFT is not credited; code changed after verifying is refused", () =>
    withCoauthor(
      undefined,
      Effect.gen(function* () {
        const { session, sessions, dir, write } = yield* project("true")
        write("a.ts", "export const a = 2\n")
        yield* sessions.command({ sessionID: session.id, command: "verify", text: "quick" })
        yield* finished(session.id)
        write("a.ts", "export const a = 3\n")
        const before = head(dir)
        yield* sessions.command({ sessionID: session.id, command: "ship", text: "late edit" })
        const refused = yield* until(() => parked(sessions, session.id), (items) => items.some((item) => item.text.includes("Not shipped")))
        expect(refused.find((item) => item.text.includes("Not shipped"))?.text).toContain("the code has changed since it was verified")
        expect(head(dir)).toBe(before)
        yield* sessions.command({ sessionID: session.id, command: "verify", text: "quick" })
        yield* until(() => finished(session.id), (run) => run?.phase === "done" && (run as { tree?: string }).tree !== undefined)
        yield* Effect.sleep("300 millis")
        yield* sessions.command({ sessionID: session.id, command: "ship", text: "after reverify" })
        yield* until(() => Effect.succeed(head(dir)), (value) => value !== before)
        expect(message(dir)).not.toContain("Co-Authored-By")
      }),
    ),
  )

  it.live("a declined /verify runs nothing and ends unproven, not stuck running", () =>
    Effect.gen(function* () {
      const marker = outside((yield* tmpdirScoped()).path, "ran")
      const { session, sessions, dir } = yield* project(`touch ${marker}`, ask)
      yield* sessions.command({ sessionID: session.id, command: "verify", text: "" })
      yield* reply(dir, (yield* asked(dir, session.id))[0]!.id, "reject")
      expect(yield* finished(session.id)).toMatchObject({ phase: "done", verdict: "unproven", stages: [{ status: "not_run", reason: "declined" }] })
      expect(existsSync(marker)).toBe(false)
    }),
  )

  it.live("/verify stop cancels the run and its commands, and only a dead process's runs are marked as restarted", () =>
    Effect.gen(function* () {
      const marker = outside((yield* tmpdirScoped()).path, "finished")
      const { session, sessions } = yield* project(`sleep 4 && touch ${marker}`)
      yield* sessions.command({ sessionID: session.id, command: "verify", text: "" })
      yield* until(
        () => stored(`run:${session.id}:project`),
        (run) => JSON.stringify(run ?? "").includes('"status":"running"'),
      )
      // Another project opening in this process stops a run an earlier process left, and leaves this one running.
      const left = { boot: "an-earlier-process", round: 0, run: { id: "r", tree: "t", started: 0, phase: "running", stages: [] } }
      yield* storage.pipe(Effect.flatMap((store) => store.set("run:ses_gone:project", left)))
      const other = yield* project("true")
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.scoped, at(other.dir))
      expect(yield* until(() => stored("run:ses_gone:project"), (value) => JSON.stringify(value).includes("RIFT restarted"))).toMatchObject({
        run: { phase: "cancelled", reason: "RIFT restarted" },
      })
      expect(yield* stored(`run:${session.id}:project`)).toMatchObject({ run: { phase: "running" } })
      yield* sessions.command({ sessionID: session.id, command: "verify", text: "stop" })
      expect(yield* finished(session.id)).toMatchObject({ phase: "cancelled", stages: [{ status: "not_run", reason: "cancelled" }] })
      yield* Effect.sleep("4500 millis")
      expect(existsSync(marker)).toBe(false)
    }),
  )

  it.live("/verify fix hands the report to the agent, and its fix is checked like any turn", () =>
    Effect.gen(function* () {
      const { session, sessions, dir, write } = yield* project("bun test")
      cart(dir)
      write("cart.ts", "export const total = (a: number, b: number) => a - b\n")
      const seen: string[] = []
      yield* serve((request, turn) => {
        seen.push(JSON.stringify(request.messages))
        write("cart.ts", "export const total = (a: number, b: number) => a + b\n")
        return TestLLM.text("Done", `done-${turn}`)
      })
      yield* sessions.command({ sessionID: session.id, command: "verify", text: "fix quick" })
      yield* finished(session.id)
      yield* until(() => Effect.succeed(seen.length), (count) => count > 0)
      yield* sessions.wait(session.id)
      expect(seen[0]).toContain("The user ran /verify fix")
      expect(seen[0]).toContain("new, not failing at HEAD: cart")
      // The fix leaves only the test HEAD already failed, which goes back once more, framed as not the agent's doing.
      expect(seen).toHaveLength(2)
      expect(seen[1]).toContain("already failing before your change")
    }),
  )
})

describe("/verify arguments", () => {
  test("stop alone stops; quick, fix and paths combine in any order", () => {
    expect(RiftVerifyPlugin.parseArgs("")).toEqual({ kind: "run", quick: false, fix: false, paths: [] })
    expect(RiftVerifyPlugin.parseArgs(" stop ")).toEqual({ kind: "stop" })
    expect(RiftVerifyPlugin.parseArgs("packages/api/ fix quick ./quick")).toEqual({
      kind: "run",
      quick: true,
      fix: true,
      paths: ["packages/api", "quick"],
    })
  })

  test("a path outside the project, or stop with anything else, is a usage error", () => {
    expect(RiftVerifyPlugin.parseArgs("../elsewhere").kind).toBe("usage")
    expect(RiftVerifyPlugin.parseArgs("/etc").kind).toBe("usage")
    expect(RiftVerifyPlugin.parseArgs("stop quick").kind).toBe("usage")
  })
})
