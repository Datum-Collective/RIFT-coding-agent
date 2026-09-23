import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./graph.txt"
import { EngineeringGraph } from "../session/engineering-graph"

const Node = Schema.Struct({
  id: EngineeringGraph.Info.fields.id,
  // Models often send null for the root's parent rather than leaving it out.
  parent_id: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Id of the parent node. Omit or null only for the single root ('Product') node.",
  }),
  title: EngineeringGraph.Info.fields.title,
  status: EngineeringGraph.Info.fields.status,
  dependencies: EngineeringGraph.Info.fields.dependencies,
  files: EngineeringGraph.Info.fields.files,
  checks: EngineeringGraph.Info.fields.checks,
  decisions: EngineeringGraph.Info.fields.decisions,
})

export const Parameters = Schema.Struct({
  nodes: Schema.mutable(Schema.Array(Node)).annotate({ description: "The updated engineering graph node list" }),
})

type Metadata = {
  nodes: EngineeringGraph.Info[]
}

export const GraphWriteTool = Tool.define<typeof Parameters, Metadata, EngineeringGraph.Service>(
  "graphwrite",
  Effect.gen(function* () {
    const graph = yield* EngineeringGraph.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "graphwrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* graph.update({
            sessionID: ctx.sessionID,
            nodes: params.nodes.map((node) => ({ ...node, parent_id: node.parent_id ?? undefined })),
            owner: ctx.agent,
          })

          const nodes = yield* graph.get(ctx.sessionID)

          return {
            title: `${nodes.length} nodes`,
            output: JSON.stringify(nodes, null, 2),
            metadata: {
              nodes,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
