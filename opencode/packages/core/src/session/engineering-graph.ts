export * as EngineeringGraph from "./engineering-graph"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { EngineeringGraph } from "@opencode-ai/schema/engineering-graph"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { EngineeringGraphTable } from "./sql"

export const Info = EngineeringGraph.Info
export type Info = typeof Info.Type
export const Event = EngineeringGraph.Event

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly nodes: ReadonlyArray<Omit<Info, "owner">>
    readonly owner: string
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/EngineeringGraph") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const update = Effect.fn("EngineeringGraph.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly nodes: ReadonlyArray<Omit<Info, "owner">>
      readonly owner: string
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

    const get = Effect.fn("EngineeringGraph.get")(function* (sessionID: SessionSchema.ID) {
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

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, Database.node] })
