import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { fallbackTitle } from "./title"
import PROMPT_BRAIN_ROT from "./prompt/brain-rot.txt"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@opencode-ai/core/session/runner/max-steps"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@opencode-ai/core/shell"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Verify } from "./verify"
import { Evidence } from "./evidence"
import { EngineeringGraph } from "./engineering-graph"
import { ShellID } from "@/tool/shell/id"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const VIBE_PLAN_SYSTEM_PROMPT = `You are the planner for Vibe Mode. Analyze the user's request and the full conversation context, then output JSON only with this exact shape:
{"steps":[{"files":["path/to/file"],"functions":["functionName"],"description":"Concrete change to make in this step"}]}

Create an ordered implementation plan. Every step must name the target files and functions when known, and describe a concrete change. Do not include prose outside the JSON object.`

const VibePlanSchema = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      files: Schema.Array(Schema.String),
      functions: Schema.Array(Schema.String),
      description: Schema.String,
    }),
  ),
})
type VibePlan = {
  steps: Array<{
    files: string[]
    functions: string[]
    description: string
  }>
}

const VibePlanFromJson = Schema.fromJsonString(VibePlanSchema)

function parseVibePlan(text: string): VibePlan {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  const parsed =
    start !== -1 && end > start
      ? Schema.decodeUnknownOption(VibePlanFromJson)(text.slice(start, end + 1))
      : Option.none()
  if (Option.isSome(parsed) && parsed.value.steps.length > 0) {
    return parsed.value as unknown as VibePlan
  }
  const fallback = text.trim()
  if (!fallback) throw new Error("Vibe Mode planner returned no JSON plan")
  return { steps: [{ files: [], functions: [], description: fallback }] }
}

const CLAIMS_SYSTEM_PROMPT = `You are checking whether an agent's summary of its own work matches what it actually changed. You are given the summary and the real diff of the files it edited. Output JSON only with this exact shape:
{"mismatches":[{"claim":"what the summary asserts","reality":"what the diff actually shows"}]}

Report a mismatch only when the diff contradicts the summary, or when the summary claims a file change that is absent from the diff. Ignore claims about running commands, tests or tools, which are verified separately. Ignore anything the summary simply did not mention, and do not review code quality or style. If every file change the summary describes is supported by the diff, return {"mismatches":[]}. Do not include prose outside the JSON object.`

const VIBE_REVIEW_SYSTEM_PROMPT = `You are the reviewer for Vibe Mode. A cheaper executor model just attempted one step of your plan. Judge only from the transcript whether the step was completed fully and correctly: the described change was actually made, tool calls succeeded, nothing was left half-done, and no obvious bugs or unrelated edits were introduced. Output JSON only with this exact shape:
{"approved":true,"feedback":"short reason"}
If not approved, feedback must state exactly what is wrong and what the executor must do to fix it. Do not include prose outside the JSON object.`

const VibeReviewSchema = Schema.Struct({
  approved: Schema.Boolean,
  feedback: Schema.String,
})

function parseVibeReview(text: string) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = Schema.decodeUnknownOption(VibeReviewSchema)(JSON.parse(text.slice(start, end + 1)))
    return Option.isSome(parsed) ? parsed.value : undefined
  } catch {
    return undefined
  }
}

function formatVibePlan(plan: VibePlan) {
  return [
    "Vibe Mode plan",
    ...plan.steps.map(
      (step, index) =>
        `${index + 1}. ${step.description}\n   Files: ${step.files.join(", ") || "not specified"}\n   Functions: ${step.functions.join(", ") || "not specified"}`,
    ),
  ].join("\n")
}

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const graph = yield* EngineeringGraph.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      // Naming the session is a nicety that depends on a second model call, so it fails often: rate
      // limits, no small model, an empty reply. Every one of those used to leave the session as
      // "New session - <timestamp>" without a word in the logs, so failures are recorded here and the
      // user's own first message stands in for the title.
      const generated = yield* Effect.gen(function* () {
        const ag = yield* agents.get("title")
        if (!ag) return undefined
        const mdl = ag.model
          ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
          : ((yield* provider.getSmallModel(input.providerID)) ??
            (yield* provider.getModel(input.providerID, input.modelID)))
        const msgs = onlySubtasks
          ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
          : yield* MessageV2.toModelMessagesEffect(context, mdl)
        const text = yield* llm
          .stream({
            agent: ag,
            user: firstInfo,
            system: [],
            small: true,
            tools: {},
            model: mdl,
            sessionID: input.session.id,
            retries: 2,
            messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
          })
          .pipe(
            Stream.filter(LLMEvent.is.textDelta),
            Stream.map((e) => e.text),
            Stream.mkString,
            Effect.orDie,
          )
        return text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("session title generation failed; using the first message", {
            "session.id": input.session.id,
            error: Cause.squash(cause),
          }).pipe(Effect.as(undefined)),
        ),
      )
      const typed = firstUser.parts
        .filter((p): p is SessionV1.TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("\n")
      const cleaned = generated || fallbackTitle(onlySubtasks ? subtasks.map((p) => p.prompt).join("\n") : typed)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const resolveVibeModels = Effect.fn("SessionPrompt.resolveVibeModels")(function* (
      agent: Agent.Info,
      sessionID: SessionID,
    ) {
      const cfg = yield* config.get()
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      const override = session.metadata?.[Session.VIBE_MODE_METADATA_KEY]
      const enabled = typeof override === "boolean" ? override : cfg.vibe_mode === true
      if (!enabled) return undefined
      const plannerOverride = session.metadata?.[Session.VIBE_PLANNER_MODEL_METADATA_KEY]
      const executorOverride = session.metadata?.[Session.VIBE_EXECUTOR_MODEL_METADATA_KEY]
      const planner =
        (typeof plannerOverride === "string" ? Provider.parseModel(plannerOverride) : undefined) ??
        agent.plannerModel ??
        (cfg.plannerModel ? Provider.parseModel(cfg.plannerModel) : undefined)
      const executor =
        (typeof executorOverride === "string" ? Provider.parseModel(executorOverride) : undefined) ??
        agent.executorModel ??
        (cfg.executorModel ? Provider.parseModel(cfg.executorModel) : undefined)
      if (!planner || !executor) {
        throw new Error(
          "You haven't chosen your Vibe Mode models yet! Run /vibe to pick a smart planner and a cheap executor, then send your prompt again.",
        )
      }
      return {
        planner: yield* getModel(planner.providerID, planner.modelID, sessionID),
        executor: yield* getModel(executor.providerID, executor.modelID, sessionID),
      }
    })

    const resolveVibeTools = Effect.fn("SessionPrompt.resolveVibeTools")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      session: Session.Info
    }) {
      return yield* SessionTools.definitions(input).pipe(
        Effect.provideService(Plugin.Service, plugin),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(ToolRegistry.Service, registry),
        Effect.provideService(MCP.Service, mcp),
        Effect.provideService(Truncate.Service, truncate),
        Effect.provideService(RuntimeFlags.Service, flags),
      )
    })

    const loadSystemContext = Effect.fn("SessionPrompt.loadSystemContext")(function* (
      agent: Agent.Info,
      model: Provider.Model,
      session: Session.Info,
    ) {
      const [skills, env, instructions, mcpInstructions, cfg] = yield* Effect.all([
        sys.skills(agent),
        sys.environment(model),
        instruction.system().pipe(Effect.orDie),
        sys.mcp(agent, session.permission),
        config.get(),
      ])
      // A session's own choice beats the config default, so `/brainrot` can turn it off as well as on.
      const brainRot = session.metadata?.[Session.BRAIN_ROT_METADATA_KEY]
      const rot = typeof brainRot === "boolean" ? brainRot : cfg.brain_rot === true
      return [
        ...env,
        ...instructions,
        ...(mcpInstructions ? [mcpInstructions] : []),
        ...(skills ? [skills] : []),
        ...(rot ? [PROMPT_BRAIN_ROT] : []),
      ]
    })

    const vibeStepMessage = (input: {
      lastUser: SessionV1.User
      step: VibePlan["steps"][number]
      model: Provider.Model
      feedback?: string
      index: number
      total: number
    }): SessionV1.WithParts => {
      const messageID = MessageID.ascending()
      const text = [
        // The step number is stated rather than implied: clients read it directly instead of
        // counting step messages, which repeat whenever a step is retried or revised.
        `Execute this Vibe Mode plan step using the available tools. Step ${input.index + 1} of ${input.total}.`,
        `Target files: ${input.step.files.join(", ") || "not specified"}`,
        `Target functions: ${input.step.functions.join(", ") || "not specified"}`,
        `Instructions: ${input.step.description}`,
        ...(input.feedback
          ? [
              `A previous attempt at this step was rejected by the reviewer. Its changes are already applied; fix them rather than starting over.`,
              `Reviewer feedback: ${input.feedback}`,
            ]
          : []),
        "Work only on this step. Verify the result before replying, then stop.",
      ].join("\n")
      return {
        info: {
          ...input.lastUser,
          id: messageID,
          time: { created: Date.now() },
          model: {
            providerID: input.model.providerID,
            modelID: input.model.id,
          },
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID,
            sessionID: input.lastUser.sessionID,
            type: "text",
            text,
            synthetic: true,
          },
        ],
      }
    }

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (
        current.agent !== info.agent ||
        current.model?.providerID !== info.model.providerID ||
        current.model?.id !== info.model.modelID ||
        (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant
      ) {
        yield* sessions.setAgentModel({
          sessionID: input.sessionID,
          agent: info.agent,
          model: {
            id: info.model.modelID,
            providerID: info.model.providerID,
            variant: info.model.variant ?? "default",
          },
          time: info.time.created,
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    // Run the project's own checks once the agent claims it is done, and attach the real results.
    /**
     * Second pass of the trust layer: compares the agent's own summary against the real diff.
     * Any problem resolving the model or reading the verdict is reported as "not run" — never as
     * agreement, so a broken check cannot read as a clean bill of health.
     */
    // Keeps each early return contextually typed; a bare literal would widen `status` to string.
    const asClaims = (value: Verify.Claims) => value

    const checkClaims = Effect.fn("SessionPrompt.checkClaims")(function* (input: {
      sessionID: SessionID
      session: Session.Info
      agent: Agent.Info | undefined
      user: SessionV1.WithParts | undefined
      summary: string
      files: string[]
      planner?: Provider.Model
    }) {
      if (!input.summary) return asClaims({ status: "off" })
      const agent = input.agent
      const user = input.user?.info.role === "user" ? input.user.info : undefined
      if (!agent || !user) return asClaims({ status: "not_run", reason: "no agent context" })

      const ctx = yield* InstanceState.context
      const diff = yield* Effect.promise(() => Verify.turnDiff(ctx.directory, input.files)).pipe(
        Effect.catchCause(() => Effect.succeed("")),
      )
      if (!diff) return asClaims({ status: "not_run", reason: "no diff available" })

      const cfg = yield* config.get()
      const configured = cfg.verify_claims_model ? Provider.parseModel(cfg.verify_claims_model) : undefined
      const model = yield* (
        configured
          ? getModel(configured.providerID, configured.modelID, input.sessionID)
          : input.planner
            ? Effect.succeed(input.planner)
            : getModel(user.model.providerID, user.model.modelID, input.sessionID)
      ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!model) return asClaims({ status: "not_run", reason: "claims model unavailable" })

      yield* Effect.logInfo("verification claims check", {
        "session.id": input.sessionID,
        providerID: model.providerID,
        modelID: model.id,
      })

      const text = yield* llm
        .stream({
          user,
          sessionID: input.sessionID,
          model,
          agent,
          system: [CLAIMS_SYSTEM_PROMPT],
          messages: [
            {
              role: "user" as const,
              content: `The agent's summary of what it did:\n${input.summary}\n\nThe actual diff of the files it edited:\n${diff}`,
            },
          ],
          tools: yield* resolveVibeTools({ agent, model, session: input.session }),
          toolChoice: Provider.supportsStaticToolChoice(model) ? "none" : undefined,
          retries: 2,
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.catchCause(() => Effect.succeed("")),
        )

      const items = Verify.parseClaims(text)
      if (!items) return asClaims({ status: "not_run", reason: "unreadable verdict" })
      if (items.length === 0) return asClaims({ status: "ok" })
      return asClaims({ status: "mismatch", items })
    })

    const runVerification = Effect.fn("SessionPrompt.runVerification")(function* (
      sessionID: SessionID,
      baseline: string[],
      planner?: Provider.Model,
    ) {
      const cfg = yield* config.get()
      if (cfg.verify === false) return
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      if (session.parentID) return
      const all = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
      )
      const userIndex = all.findLastIndex(
        (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && !p.synthetic),
      )
      const turn = all.slice(userIndex + 1)
      const last = turn.findLast((m) => m.info.role === "assistant" && m.info.mode !== "vibe-planner")
      if (!last || last.info.role !== "assistant" || last.info.error) return
      const tools = turn.flatMap((m) =>
        m.parts.flatMap((p) =>
          p.type === "tool" ? [{ tool: p.tool, status: p.state.status, input: p.state.input }] : [],
        ),
      )
      if (!Verify.editedFiles(tools)) return
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("verification", { "session.id": sessionID })
      const checks = yield* Effect.promise(() =>
        Verify.resolve(ctx.directory, {
          commands: cfg.verify_commands ? [...cfg.verify_commands] : undefined,
          files: Verify.editedPaths(tools, ctx.directory),
        }),
      )
      const entries: Verify.Entry[] = checks.map((check) => ({ check }))
      const partID = PartID.ascending()
      let scopeFiles: string[] = []
      let claims: Verify.Claims = { status: "off" }
      let browser: Verify.BrowserCheck | undefined
      const planned = Evidence.plan(yield* graph.get(sessionID))
      const evidence = planned.map(Evidence.queued)
      const publish = (done: boolean) => {
        const report: Verify.Report = {
          entries,
          scopeFiles,
          scopeWarnFiles: cfg.verify_scope_warn_files ?? 15,
          done,
          claims,
          browser,
          evidence,
        }
        return sessions.updatePart({
          id: partID,
          messageID: last.info.id,
          sessionID,
          type: "text",
          text: Verify.format(report),
          // Structured twin of the text, so clients can render verification as state
          // instead of parsing the prose back out of the transcript.
          metadata: { [Verify.METADATA_KEY]: Verify.summarize(report) },
        } satisfies SessionV1.TextPart)
      }

      const agent = yield* agents.get(last.info.agent)
      const ruleset = Permission.merge(agent?.permission ?? [], session.permission ?? [])
      const timeoutMs = cfg.verify_timeout_ms ?? 10 * 60 * 1000

      yield* Effect.gen(function* () {
        yield* publish(false)
        // Sequential on purpose: checks often share build caches and lockfiles.
        for (const entry of entries) {
          const command = entry.check.command
          // Verification runs shell commands, so it goes through the same permission rules as the bash tool.
          const denied = yield* permission
            .ask({
              permission: ShellID.ToolID,
              patterns: [command],
              always: [command],
              sessionID,
              metadata: { command, cwd: entry.check.dir ?? ctx.directory, source: "verification" },
              ruleset,
            })
            .pipe(
              Effect.as(false),
              Effect.catch(() => Effect.succeed(true)),
            )
          entry.result = denied
            ? Verify.notRun(entry.check, "permission denied")
            : yield* Effect.promise(async (signal) => {
                try {
                  return await Verify.runCheck(entry.check, ctx.directory, {
                    timeoutMs,
                    cancel: signal,
                    shell: Shell.acceptable(cfg.shell),
                  })
                } catch (error) {
                  return Verify.notRun(
                    entry.check,
                    `could not start: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              })
          yield* publish(false)
        }
        // A UI change can typecheck and pass its tests while throwing on every render. With no
        // URL configured, a page the turn built is opened directly, so static sites get checked too.
        const page =
          cfg.verify_browser_url ??
          (yield* Effect.promise(() => Verify.editedPage(Verify.editedPaths(tools, ctx.directory))))
        if (page) {
          browser = yield* Effect.promise(() => Verify.checkBrowser(page)).pipe(
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
          yield* publish(false)
        }

        // Evidence per graph node. The agent chose these commands and URLs, so each one clears the
        // permission it would need as a tool call before RIFT runs it.
        for (const [index, item] of planned.entries()) {
          const request = Evidence.permission(item, ctx.worktree)
          const denied = request
            ? yield* permission
                .ask({ ...request, always: request.patterns, sessionID, metadata: { source: "evidence" }, ruleset })
                .pipe(
                  Effect.as(false),
                  Effect.catch(() => Effect.succeed(true)),
                )
            : false
          evidence[index] = denied
            ? Evidence.notRun(item, "permission denied")
            : yield* Effect.promise((signal) =>
                Evidence.run(item, {
                  directory: ctx.directory,
                  timeoutMs,
                  cancel: signal,
                  shell: Shell.acceptable(cfg.shell),
                }).catch((error: unknown) =>
                  Evidence.notRun(item, `could not run: ${error instanceof Error ? error.message : String(error)}`),
                ),
              )
          yield* publish(false)
        }

        const before = new Set(baseline)
        scopeFiles = (yield* Effect.promise(() => Verify.changedFiles(ctx.directory))).filter(
          (file) => !before.has(file),
        )

        if (cfg.verify_claims !== false) {
          claims = { status: "pending" }
          yield* publish(false)
          claims = yield* checkClaims({
            sessionID,
            session,
            agent,
            user: all[userIndex],
            summary: last.parts
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n")
              .trim(),
            files: Verify.editedPaths(tools, ctx.directory),
            planner,
          })
        }
        yield* publish(true)
      }).pipe(
        // A cancelled session must not leave the report stuck on "queued".
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            for (const entry of entries) entry.result ??= Verify.notRun(entry.check, "cancelled")
            if (claims.status === "pending") claims = { status: "not_run", reason: "cancelled" }
            yield* publish(true)
          }).pipe(Effect.ignore),
        ),
      )
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let vibePlan: VibePlan | undefined
        let vibeStepIndex = 0
        let vibeModels: { planner: Provider.Model; executor: Provider.Model } | undefined
        const vibeAttempts = new Map<number, number>()
        const vibeEscalated = new Set<number>()
        let vibeStepUserID: MessageID | undefined
        let vibeAdvancedAssistantID: MessageID | undefined
        let vibeRetryPending = false
        const vibeReviewEscalated = new Set<number>()
        const verifyBaseline = yield* Effect.promise(() => Verify.changedFiles(ctx.directory)).pipe(
          Effect.catchCause(() => Effect.succeed([] as string[])),
        )
        const vibeReviewRounds = new Map<number, number>()
        const vibeFeedback = new Map<number, string>()
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        const reviseVibeStep = Effect.fn("SessionPrompt.reviseVibeStep")(function* (input: {
          agent: Agent.Info
          user: SessionV1.User
          messages: SessionV1.WithParts[]
          step: VibePlan["steps"][number]
          failure: string
          model: Provider.Model
        }) {
          const system = yield* loadSystemContext(input.agent, input.model, session)
          const messages = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
          const text = yield* llm
            .stream({
              user: input.user,
              sessionID,
              model: input.model,
              agent: input.agent,
              system: [VIBE_PLAN_SYSTEM_PROMPT, ...system],
              messages: [
                ...messages,
                {
                  role: "user" as const,
                  content: `The current Vibe step failed after an executor attempt. Revise only this step and return a one-step plan.\nCurrent step: ${JSON.stringify(input.step)}\nFailure: ${input.failure}`,
                },
              ],
              tools: yield* resolveVibeTools({ agent: input.agent, model: input.model, session }),
              toolChoice: Provider.supportsStaticToolChoice(input.model) ? "none" : undefined,
              retries: 2,
            })
            .pipe(
              Stream.filter(LLMEvent.is.textDelta),
              Stream.map((event) => event.text),
              Stream.mkString,
              Effect.orDie,
            )
          return parseVibePlan(text)
        })

        const recordPlannerMessage = Effect.fn("SessionPrompt.recordPlannerMessage")(function* (input: {
          agent: Agent.Info
          parentID: MessageID
          model: Provider.Model
          text: string
        }) {
          const message: SessionV1.Assistant = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID,
            parentID: input.parentID,
            role: "assistant",
            mode: "vibe-planner",
            agent: input.agent.name,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: input.model.id,
            providerID: input.model.providerID,
            time: { created: Date.now(), completed: Date.now() },
            finish: "stop",
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: message.id,
            sessionID,
            type: "text",
            text: input.text,
          } satisfies SessionV1.TextPart)
        })

        const reviewVibeStep = Effect.fn("SessionPrompt.reviewVibeStep")(function* (input: {
          agent: Agent.Info
          user: SessionV1.User
          stepUserID: MessageID
          step: VibePlan["steps"][number]
          model: Provider.Model
        }) {
          const all = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
          const transcript = all
            .filter((item) => item.info.id >= input.stepUserID)
            .sort((a, b) => (a.info.id < b.info.id ? -1 : 1))
          const system = yield* loadSystemContext(input.agent, input.model, session)
          const messages = yield* MessageV2.toModelMessagesEffect(transcript, input.model)
          // The reviewer has no tools, so show it what is on disk now and what changed.
          const [fileContext, diff] = yield* Effect.promise(() =>
            Promise.all([
              Verify.fileContents(ctx.directory, input.step.files),
              Verify.diffOf(ctx.directory, input.step.files),
            ]),
          ).pipe(Effect.catchCause(() => Effect.succeed(["", ""] as const)))
          const text = yield* llm
            .stream({
              user: input.user,
              sessionID,
              model: input.model,
              agent: input.agent,
              system: [
                VIBE_REVIEW_SYSTEM_PROMPT,
                ...system,
                ...(diff ? [`Uncommitted changes to the step's target files (git diff against HEAD):\n${diff}`] : []),
                ...(fileContext ? [`Current contents of the step's target files:\n${fileContext}`] : []),
              ],
              messages: [
                ...messages,
                {
                  role: "user" as const,
                  content: `Review the executor's work on this step now.\nStep: ${JSON.stringify(input.step)}`,
                },
              ],
              tools: yield* resolveVibeTools({ agent: input.agent, model: input.model, session }),
              toolChoice: Provider.supportsStaticToolChoice(input.model) ? "none" : undefined,
              retries: 2,
            })
            .pipe(
              Stream.filter(LLMEvent.is.textDelta),
              Stream.map((event) => event.text),
              Stream.mkString,
              Effect.orDie,
            )
          // An unparseable verdict must not silently approve or wedge the loop.
          return (
            parseVibeReview(text) ?? {
              approved: false,
              feedback: "Reviewer returned an unparseable verdict; re-verify the step.",
            }
          )
        })

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          // Planner notes (plan, review verdicts) are stored as assistant messages; skip them so the
          // executor's own turn decides whether a step finished.
          const turnAssistantMsg =
            lastAssistant?.mode === "vibe-planner"
              ? msgs.findLast((msg) => msg.info.role === "assistant" && msg.info.mode !== "vibe-planner")
              : msgs.findLast((msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id)
          const turnAssistant = turnAssistantMsg?.info.role === "assistant" ? turnAssistantMsg.info : undefined
          const lastAssistantMsg = turnAssistantMsg
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          if (
            turnAssistant?.finish &&
            !["tool-calls", "unknown"].includes(turnAssistant.finish) &&
            !hasToolCalls &&
            turnAssistant.parentID === lastUser.id &&
            turnAssistant.id !== vibeAdvancedAssistantID &&
            !vibeRetryPending
          ) {
            if (vibePlan && vibeStepIndex + 1 < vibePlan.steps.length) {
              vibeStepIndex++
              vibeStepUserID = undefined
              vibeAdvancedAssistantID = turnAssistant.id
              continue
            }
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                "session.id": sessionID,
                messageID: turnAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }
            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
            break
          }

          vibeRetryPending = false
          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          vibeModels ??= yield* resolveVibeModels(agent, sessionID)
          if (vibeModels && !vibePlan) {
            const plannerSystem = yield* loadSystemContext(agent, vibeModels.planner, session)
            const plannerMessages = yield* MessageV2.toModelMessagesEffect(msgs, vibeModels.planner)
            yield* Effect.logInfo("vibe planner turn", {
              "session.id": sessionID,
              providerID: vibeModels.planner.providerID,
              modelID: vibeModels.planner.id,
            })
            const plannerText = yield* llm
              .stream({
                user: lastUser,
                sessionID,
                model: vibeModels.planner,
                agent,
                system: [VIBE_PLAN_SYSTEM_PROMPT, ...plannerSystem],
                messages: [
                  ...plannerMessages,
                  { role: "user", content: "Create the implementation plan for the user's request now." },
                ],
                tools: yield* resolveVibeTools({ agent, model: vibeModels.planner, session }),
                toolChoice: Provider.supportsStaticToolChoice(vibeModels.planner) ? "none" : undefined,
                retries: 2,
              })
              .pipe(
                Stream.filter(LLMEvent.is.textDelta),
                Stream.map((event) => event.text),
                Stream.mkString,
                Effect.orDie,
              )
            vibePlan = parseVibePlan(plannerText)
            yield* recordPlannerMessage({
              agent,
              parentID: lastUser.id,
              model: vibeModels.planner,
              text: formatVibePlan(vibePlan),
            })
          }
          const turnModel = vibeModels?.executor ?? model
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = vibePlan ? vibeStepIndex + 1 >= vibePlan.steps.length : step >= maxSteps
          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
          )

          let executionUser: SessionV1.User = lastUser
          let executionMessages: SessionV1.WithParts[] = msgs
          const continuingVibeStep = vibePlan && vibeStepUserID === lastUser.id
          if (vibePlan && !continuingVibeStep) {
            const stepMessage = vibeStepMessage({
              lastUser,
              step: vibePlan.steps[vibeStepIndex]!,
              model: turnModel,
              feedback: vibeFeedback.get(vibeStepIndex),
              index: vibeStepIndex,
              total: vibePlan.steps.length,
            })
            yield* sessions.updateMessage(stepMessage.info)
            for (const part of stepMessage.parts) yield* sessions.updatePart(part)
            executionUser = stepMessage.info as SessionV1.User
            executionMessages = [stepMessage]
            vibeStepUserID = stepMessage.info.id
          } else if (continuingVibeStep) {
            const stepStart = msgs.findIndex((message) => message.info.id === vibeStepUserID)
            executionMessages = stepStart === -1 ? msgs : msgs.slice(stepStart)
          }

          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: executionUser.id,
            role: "assistant",
            mode: vibePlan ? "vibe-executor" : agent.name,
            agent: agent.name,
            variant: executionUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: turnModel.id,
            providerID: turnModel.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model: turnModel,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = executionMessages.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model: turnModel,
              processor: handle,
              bypassAgentCheck,
              messages: executionMessages,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
              Effect.provideService(RuntimeFlags.Service, flags),
            )

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const system = yield* loadSystemContext(agent, turnModel, session)
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            const modelMsgs = vibePlan
              ? yield* MessageV2.toModelMessagesEffect(executionMessages, turnModel)
              : yield* MessageV2.toModelMessagesEffect(msgs, turnModel)
            if (vibePlan) {
              yield* Effect.logInfo("vibe executor turn", {
                "session.id": sessionID,
                step: vibeStepIndex + 1,
                total: vibePlan.steps.length,
                providerID: turnModel.providerID,
                modelID: turnModel.id,
              })
            }
            const result = yield* handle.process({
              user: executionUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [
                ...modelMsgs,
                ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
              ],
              tools,
              model: turnModel,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            if (vibePlan) {
              const current = yield* MessageV2.get({ sessionID, messageID: handle.message.id }).pipe(
                Effect.provideService(Database.Service, database),
                Effect.orDie,
              )
              const output = current.parts
                .filter((part): part is SessionV1.TextPart => part.type === "text")
                .map((part) => part.text)
                .join("\n")
                .toLowerCase()
              const toolFailed = current.parts.some((part) => part.type === "tool" && part.state.status === "error")
              // A turn that ends in tool calls is mid-step: the results still have to go back to
              // the executor. Reviewing here would judge half-finished work and restart the step.
              const stepFinished =
                !!handle.message.finish &&
                !["tool-calls", "unknown"].includes(handle.message.finish) &&
                !current.parts.some(
                  (part) =>
                    part.type === "tool" && (part.state.status === "running" || part.state.status === "pending"),
                )
              const reportedFailure =
                output?.includes("can't proceed") ||
                output?.includes("cannot proceed") ||
                output?.includes("unable to complete") ||
                output?.includes("failed to complete")
              const failed = !!handle.message.error || !!toolFailed || !!reportedFailure
              if (failed) {
                const attempt = (vibeAttempts.get(vibeStepIndex) ?? 0) + 1
                vibeAttempts.set(vibeStepIndex, attempt)
                const configuredAttempts = (yield* config.get()).vibe_max_attempts ?? 2
                const maxAttempts = configuredAttempts <= 0 ? Infinity : configuredAttempts
                if (vibeEscalated.has(vibeStepIndex)) return "break" as const
                if (attempt >= maxAttempts) {
                  vibeEscalated.add(vibeStepIndex)
                  const failure = handle.message.error?.name ?? (reportedFailure ? output : "tool error")
                  const revised = yield* reviseVibeStep({
                    agent,
                    user: executionUser,
                    messages: executionMessages,
                    step: vibePlan.steps[vibeStepIndex]!,
                    failure: failure ?? "executor failure",
                    model: vibeModels!.planner,
                  })
                  vibePlan.steps[vibeStepIndex] = revised.steps[0]!
                  vibeAttempts.set(vibeStepIndex, 0)
                  vibeStepUserID = undefined
                  yield* recordPlannerMessage({
                    agent,
                    parentID: executionUser.id,
                    model: vibeModels!.planner,
                    text: `Revised Vibe Mode step\n${formatVibePlan(revised)}`,
                  })
                }
                return "continue" as const
              }
              vibeAttempts.delete(vibeStepIndex)

              const reviewedStep = vibePlan.steps[vibeStepIndex]
              if (stepFinished && (yield* config.get()).vibe_review !== false && vibeStepUserID && reviewedStep) {
                const step = reviewedStep
                const verdict = yield* reviewVibeStep({
                  agent,
                  user: executionUser,
                  stepUserID: vibeStepUserID,
                  step,
                  model: vibeModels!.planner,
                })
                const label = `Vibe Mode review of step ${vibeStepIndex + 1}/${vibePlan.steps.length}`
                if (verdict.approved) {
                  vibeReviewRounds.delete(vibeStepIndex)
                  vibeFeedback.delete(vibeStepIndex)
                  yield* recordPlannerMessage({
                    agent,
                    parentID: executionUser.id,
                    model: vibeModels!.planner,
                    text: `${label}: approved${verdict.feedback ? `\n${verdict.feedback}` : ""}`,
                  })
                } else {
                  const rounds = (vibeReviewRounds.get(vibeStepIndex) ?? 0) + 1
                  vibeReviewRounds.set(vibeStepIndex, rounds)
                  const configuredRounds = (yield* config.get()).vibe_review_max_rounds ?? 2
                  const maxRounds = configuredRounds <= 0 ? Infinity : configuredRounds
                  yield* recordPlannerMessage({
                    agent,
                    parentID: executionUser.id,
                    model: vibeModels!.planner,
                    text: `${label}: changes requested (${rounds}/${Number.isFinite(maxRounds) ? maxRounds : "unlimited"})\n${verdict.feedback}`,
                  })
                  if (rounds < maxRounds) {
                    vibeFeedback.set(vibeStepIndex, verdict.feedback)
                    vibeStepUserID = undefined
                    vibeRetryPending = true
                    return "continue" as const
                  }
                  if (!vibeReviewEscalated.has(vibeStepIndex)) {
                    vibeReviewEscalated.add(vibeStepIndex)
                    const revised = yield* reviseVibeStep({
                      agent,
                      user: executionUser,
                      messages: executionMessages,
                      step,
                      failure: `Reviewer rejected the executor's work ${rounds} times: ${verdict.feedback}`,
                      model: vibeModels!.planner,
                    })
                    vibePlan.steps[vibeStepIndex] = revised.steps[0]!
                    vibeReviewRounds.delete(vibeStepIndex)
                    vibeFeedback.delete(vibeStepIndex)
                    vibeStepUserID = undefined
                    vibeRetryPending = true
                    yield* recordPlannerMessage({
                      agent,
                      parentID: executionUser.id,
                      model: vibeModels!.planner,
                      text: `Revised Vibe Mode step\n${formatVibePlan(revised)}`,
                    })
                    return "continue" as const
                  }
                  // Already revised once: stop looping and move on rather than burn tokens forever.
                  yield* recordPlannerMessage({
                    agent,
                    parentID: executionUser.id,
                    model: vibeModels!.planner,
                    text: `${label}: unresolved after revision; continuing with reviewer concerns outstanding.`,
                  })
                }
              }
            }

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // Surface any content-filter finish (e.g. Anthropic stop_reason:
              // refusal) as an error. These turns may have produced no visible
              // output at all — previously the session went idle silently — or
              // partial text that was cut off by the provider's filter.
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                return "break" as const
              }
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        yield* runVerification(sessionID, verifyBaseline, vibeModels?.planner)
        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID))
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...uniqueTemplateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionStatus.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    Truncate.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionSummary.node,
    SystemPrompt.node,
    EngineeringGraph.node,
    LLM.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as SessionPrompt from "./prompt"
