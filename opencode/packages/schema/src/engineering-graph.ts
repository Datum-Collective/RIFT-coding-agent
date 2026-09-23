export * as EngineeringGraph from "./engineering-graph"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { optional } from "./schema"
import { SessionID } from "./session-id"

export const Status = Schema.Literals(["not_started", "in_progress", "blocked", "testing", "done", "failed"])

export const Info = Schema.Struct({
  id: Schema.String.annotate({ description: "Stable id for this node, e.g. 'auth.api'" }),
  parent_id: optional(Schema.String).annotate({
    description: "Id of the parent node. Omit only for the single root ('Product') node.",
  }),
  title: Schema.String.annotate({ description: "Short human-readable name for this node" }),
  status: Status,
  owner: Schema.String.annotate({ description: "Agent that owns this node" }),
  dependencies: Schema.Array(Schema.String).annotate({ description: "Ids of nodes this node depends on" }),
  files: Schema.Array(Schema.String).annotate({ description: "Files relevant to this node" }),
  tests: Schema.Array(Schema.String).annotate({ description: "Tests relevant to this node" }),
  decisions: Schema.Array(Schema.String).annotate({ description: "Key decisions made for this node" }),
  evidence: Schema.Array(Schema.String).annotate({ description: "Evidence this node's work is correct" }),
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
