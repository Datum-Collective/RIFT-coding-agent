import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTable, EngineeringGraphTable } from "@opencode-ai/core/session/sql"
import { EngineeringGraph } from "@opencode-ai/core/session/engineering-graph"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, EngineeringGraph.node])))
const sessionID = SessionV2.ID.make("ses_graph_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "graph",
      directory: "/project",
      title: "graph",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const node = (id: string, overrides: Partial<Omit<EngineeringGraph.Info, "owner">> = {}) => ({
  id,
  parent_id: undefined,
  title: id,
  status: "not_started" as const,
  dependencies: [],
  files: [],
  tests: [],
  decisions: [],
  evidence: [],
  ...overrides,
})

describe("EngineeringGraph", () => {
  it.effect("replaces persisted nodes in order, stamps the owner, and publishes updates", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const graph = yield* EngineeringGraph.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === EngineeringGraph.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* graph.update({
        sessionID,
        owner: "build",
        nodes: [node("product"), node("auth", { parent_id: "product", status: "in_progress", dependencies: [] })],
      })
      expect(yield* graph.get(sessionID)).toEqual([
        { ...node("product"), owner: "build" },
        { ...node("auth", { parent_id: "product", status: "in_progress" }), owner: "build" },
      ])
      expect(
        (
          yield* db
            .select()
            .from(EngineeringGraphTable)
            .orderBy(asc(EngineeringGraphTable.position))
            .all()
            .pipe(Effect.orDie)
        ).map((row) => ({ node_id: row.node_id, position: row.position })),
      ).toEqual([
        { node_id: "product", position: 0 },
        { node_id: "auth", position: 1 },
      ])

      yield* graph.update({
        sessionID,
        owner: "subagent-auth",
        nodes: [node("product", { status: "done" })],
      })
      expect(yield* graph.get(sessionID)).toEqual([{ ...node("product", { status: "done" }), owner: "subagent-auth" }])

      yield* graph.update({ sessionID, owner: "build", nodes: [] })
      expect(yield* graph.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          nodes: [
            { ...node("product"), owner: "build" },
            { ...node("auth", { parent_id: "product", status: "in_progress" }), owner: "build" },
          ],
        },
        { sessionID, nodes: [{ ...node("product", { status: "done" }), owner: "subagent-auth" }] },
        { sessionID, nodes: [] },
      ])
    }),
  )
})
