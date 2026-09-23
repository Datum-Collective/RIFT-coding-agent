import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { EngineeringGraphTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EngineeringGraph as EngineeringGraphSchema } from "@opencode-ai/schema/engineering-graph"

export const Info = EngineeringGraphSchema.Info
export type Info = EngineeringGraphSchema.Info

export const Event = EngineeringGraphSchema.Event

export interface Interface {
  readonly update: (input: {
    sessionID: SessionID
    nodes: ReadonlyArray<Omit<Info, "owner">>
    owner: string
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EngineeringGraph") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("EngineeringGraph.update")(function* (input: {
      sessionID: SessionID
      nodes: ReadonlyArray<Omit<Info, "owner">>
      owner: string
    }) {
      const nodes = input.nodes.map((node) => ({ ...node, owner: input.owner }))
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(EngineeringGraphTable).where(eq(EngineeringGraphTable.session_id, input.sessionID)).run()
            if (nodes.length === 0) return
            yield* tx
              .insert(EngineeringGraphTable)
              .values(
                nodes.map((node, position) => ({
                  session_id: input.sessionID,
                  node_id: node.id,
                  parent_id: node.parent_id,
                  title: node.title,
                  status: node.status,
                  owner: node.owner,
                  dependencies: [...node.dependencies],
                  files: [...node.files],
                  checks: [...node.checks],
                  decisions: [...node.decisions],
                  position,
                })),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, nodes })
    })

    const get = Effect.fn("EngineeringGraph.get")(function* (sessionID: SessionID) {
      const rows = yield* db
        .select()
        .from(EngineeringGraphTable)
        .where(eq(EngineeringGraphTable.session_id, sessionID))
        .orderBy(asc(EngineeringGraphTable.position))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        id: row.node_id,
        parent_id: row.parent_id ?? undefined,
        title: row.title,
        status: row.status,
        owner: row.owner,
        dependencies: row.dependencies,
        files: row.files,
        checks: row.checks,
        decisions: row.decisions,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })

export * as EngineeringGraph from "./engineering-graph"
