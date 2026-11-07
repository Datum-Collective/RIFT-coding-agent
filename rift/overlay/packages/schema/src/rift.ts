export * as Rift from "./rift.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/** An engineering graph node's verdict. */
export const Verdict = Schema.Literals(["proven", "failed", "stale", "unproven", "at_risk"])

export const Node = Schema.Struct({
  id: Schema.String,
  parent: optional(Schema.String),
  title: Schema.String,
  verdict: Verdict,
  because: Schema.Array(Schema.String),
})
export type Node = typeof Node.Type

export const StageStatus = Schema.Literals(["pending", "running", "passed", "flaky", "failed", "timed_out", "skipped", "not_run"])
export const RunVerdict = Schema.Literals(["verified", "regressed", "failing", "unproven", "tampered"])
export type RunVerdict = typeof RunVerdict.Type

export const Stage = Schema.Struct({
  id: Schema.String,
  unit: Schema.String,
  kind: Schema.String,
  command: Schema.String,
  status: StageStatus,
  attempt: optional(Schema.Number),
  ms: optional(Schema.Number),
  reason: optional(Schema.String),
  /** Failing tests the change introduced, and ones the baseline fails too. */
  introduced: optional(Schema.Number),
  preexisting: optional(Schema.Number),
})
export type Stage = typeof Stage.Type

const RunBase = { id: Schema.String, tree: Schema.String, started: Schema.Number, stages: Schema.Array(Stage) }
export const Run = Schema.Union([
  Schema.Struct({
    ...RunBase,
    phase: Schema.Literals(["preparing", "asking", "running", "comparing", "mutating"]),
    mutants: optional(Schema.Struct({ done: Schema.Number, total: Schema.Number })),
  }),
  Schema.Struct({
    ...RunBase,
    phase: Schema.Literal("done"),
    finished: Schema.Number,
    verdict: RunVerdict,
    headline: Schema.String,
    receipt: Schema.String,
  }),
  Schema.Struct({ ...RunBase, phase: Schema.Literal("cancelled"), finished: Schema.Number, reason: Schema.String }),
])
export type Run = typeof Run.Type

/** Composed when read from each writer's own key, so the per-turn run, /verify and the graph never share one. */
export const State = Schema.Struct({
  /** The per-turn run, and the fix rounds used on the current prompt. */
  change: optional(Schema.Struct({ run: Run, round: Schema.Number })),
  /** The latest /verify. */
  project: optional(Run),
  graph: Schema.Array(Node),
})
export type State = typeof State.Type

export const Definition = Rpc.define({
  id: "rift.verify",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(State)),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, state: State })),
    },
  },
})
