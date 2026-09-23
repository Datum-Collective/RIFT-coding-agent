export * as EngineeringGraph from "./engineering-graph"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { optional } from "./schema"
import { SessionID } from "./session-id"

export const Status = Schema.Literals(["not_started", "in_progress", "blocked", "testing", "done", "failed"])

export const CheckKind = Schema.Literals([
  "typecheck",
  "unit",
  "integration",
  "browser",
  "http",
  "screenshot",
  "static",
  "security",
  "load",
  "production",
])

/**
 * How a node should be proven. The agent declares it; RIFT runs it and records the result, so a
 * node is only ever shown as proven by evidence RIFT produced itself.
 */
export const Check = Schema.Struct({
  kind: CheckKind,
  label: optional(Schema.String).annotate({ description: "What this check proves, e.g. 'upload accepts 500MB'" }),
  command: optional(Schema.String).annotate({
    description: "Shell command that exits 0 when the check passes. Use for type, unit, integration, static, security and load checks.",
  }),
  cwd: optional(Schema.String).annotate({ description: "Absolute directory to run `command` in. Defaults to the project root." }),
  url: optional(Schema.String).annotate({
    description: "Page or endpoint to load. Use for browser, screenshot, http and production checks.",
  }),
}).annotate({ identifier: "EngineeringGraphCheck" })
export interface Check extends Schema.Schema.Type<typeof Check> {}

export const Info = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable id for this node, e.g. 'auth.api'" }),
  parent_id: optional(Schema.String).annotate({
    description: "Id of the parent node. Omit only for the single root ('Product') node.",
  }),
  title: Schema.String.annotate({ description: "Short human-readable name for this node" }),
  status: Status,
  owner: Schema.String.annotate({ description: "Agent that owns this node" }),
  dependencies: Schema.Array(Schema.String).annotate({ description: "Ids of nodes this node depends on" }),
  files: Schema.Array(Schema.String).annotate({ description: "Files that implement this node" }),
  checks: Schema.Array(Check).annotate({ description: "How RIFT should prove this node works" }),
  decisions: Schema.Array(Schema.String).annotate({ description: "Key decisions made for this node" }),
}).annotate({ identifier: "EngineeringGraphNode" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "graph.updated",
  schema: {
    sessionID: SessionID,
    nodes: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
