export * as Rift from "./rift.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

export const CheckStatus = Schema.Literals(["passed", "failed", "timed_out", "not_run"])
export const Verdict = Schema.Literals(["proven", "failed", "stale", "unproven", "at_risk"])

export const Check = Schema.Struct({
  command: Schema.String,
  status: CheckStatus,
  reason: optional(Schema.String),
  ms: Schema.Number,
})
export type Check = typeof Check.Type

export const Node = Schema.Struct({
  id: Schema.String,
  parent: optional(Schema.String),
  title: Schema.String,
  verdict: Verdict,
  because: Schema.Array(Schema.String),
})
export type Node = typeof Node.Type

export const State = Schema.Struct({
  running: Schema.Boolean,
  /** Fix rounds used on the current prompt. */
  round: Schema.Number,
  checks: Schema.Array(Check),
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
