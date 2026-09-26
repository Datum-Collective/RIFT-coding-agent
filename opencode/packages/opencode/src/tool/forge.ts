import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./forge.txt"

export const STAGES = [
  "goal",
  "requirements",
  "architecture",
  "graph",
  "agents",
  "verify",
  "adversarial",
  "repair",
  "evidence",
  "gate",
  "ship",
] as const

export const Parameters = Schema.Struct({
  stage: Schema.Literals(STAGES).annotate({ description: "The pipeline stage this update is about" }),
  status: Schema.Literals(["active", "done", "failed", "skipped"]).annotate({
    description:
      "active when you start or re-open the stage, done when its artifact is final, failed when it cannot be completed, skipped when it does not apply",
  }),
  summary: Schema.String.annotate({ description: "One line describing the stage's current artifact or outcome" }),
  items: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          text: Schema.String,
          status: Schema.optional(Schema.Literals(["pending", "active", "done", "failed", "warn"])),
        }),
      ),
    ),
  ).annotate({
    description: "The stage's artifact as short lines: requirements, decisions, work items, findings, evidence",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type Metadata = {
  stage: Params["stage"]
  status: Params["status"]
  approved?: boolean
}

export const ForgeTool = Tool.define(
  "forge",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Params, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const metadata: Metadata = { stage: params.stage, status: params.status }
        if (params.stage === "gate" && params.status === "active") {
          // Blocks until the human answers. A rejection with feedback fails this call with that
          // feedback, which is how a person steers the pipeline from the gate.
          yield* ctx.ask({
            permission: "forge_gate",
            patterns: ["*"],
            always: [],
            metadata: { summary: params.summary, items: params.items ?? [] },
          })
          return {
            title: "Human gate approved",
            output: "The human approved shipping. Record the gate as done, then run the ship stage.",
            metadata: { ...metadata, approved: true },
          }
        }
        return {
          title: `${params.stage} · ${params.status}`,
          output: nextStep(params),
          metadata,
        }
      }),
  } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>),
)

function nextStep(params: Params) {
  if (params.status !== "done" && params.status !== "skipped") return `Recorded ${params.stage} as ${params.status}.`
  const next = STAGES[STAGES.indexOf(params.stage) + 1]
  if (!next) return "Recorded ship as done. The pipeline is complete; give the user a short closing summary."
  return `Recorded ${params.stage} as ${params.status}. Next stage: ${next}.`
}
