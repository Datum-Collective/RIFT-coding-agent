export * as GraphWriteTool from "./graphwrite"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { EngineeringGraph } from "../session/engineering-graph"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "graphwrite"

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
  tests: EngineeringGraph.Info.fields.tests,
  decisions: EngineeringGraph.Info.fields.decisions,
  evidence: EngineeringGraph.Info.fields.evidence,
})

export const Input = Schema.Struct({
  nodes: Schema.Array(Node).annotate({ description: "The updated engineering graph node list" }),
})

export const Output = Schema.Struct({
  nodes: Schema.Array(EngineeringGraph.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.nodes, null, 2)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const graph = yield* EngineeringGraph.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Model the software being built as a live graph: a single root node (the product), " +
            "feature nodes as its children, and subtask nodes (e.g. API, Database, Frontend, Tests) as " +
            "children of each feature. Keep status, dependencies, files, tests, decisions, and evidence " +
            "current for every node as work proceeds. Always pass the full current node list.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              yield* graph.update({
                sessionID: context.sessionID,
                nodes: input.nodes.map((node) => ({ ...node, parent_id: node.parent_id ?? undefined })),
                owner: context.agent,
              })
              const nodes = yield* graph.get(context.sessionID)
              return { nodes }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to update engineering graph" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/graphwrite",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, EngineeringGraph.node],
})
