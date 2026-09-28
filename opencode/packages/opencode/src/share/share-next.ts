import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import type * as SDK from "@opencode-ai/sdk/v2"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Effect, Exit, Layer, Schema, Scope, Context } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { SessionShareTable } from "@opencode-ai/core/share/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2 } from "@opencode-ai/core/event"
import { GitHubToken } from "./github-token"
import { RiftShare } from "./rift-share"

const flag = (name: string) => process.env[name] === "true" || process.env[name] === "1"
const disabled = flag("RIFT_DISABLE_SHARE") || flag("OPENCODE_DISABLE_SHARE")

const GITHUB = "https://api.github.com"
// GitHub caps content-creating requests at roughly 500 an hour, and a streaming session changes
// many times a second, so edits to a shared session are batched before the gist is rewritten.
const DEBOUNCE = "5 seconds"

const Gist = Schema.Struct({ id: Schema.String })

export type Share = { id: string; url: string; secret: string }

type State = {
  scope: Scope.Closeable
  shared: Map<SessionID, Share | null>
  pending: Set<SessionID>
}

export interface Interface {
  readonly init: () => Effect.Effect<void, unknown>
  /** Where share links open. */
  readonly url: () => Effect.Effect<string>
  readonly create: (sessionID: SessionID) => Effect.Effect<Share, unknown>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShareNext") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const http = yield* HttpClient.HttpClient
    const provider = yield* Provider.Service
    const session = yield* Session.Service
    const github = yield* GitHubToken.Service

    const gist = Effect.fn("ShareNext.gist")(function* (method: "POST" | "PATCH" | "DELETE", path: string, body?: object) {
      const token = yield* github.get()
      const request = HttpClientRequest.make(method)(`${GITHUB}${path}`).pipe(
        HttpClientRequest.setHeaders({
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "rift",
          "x-github-api-version": "2022-11-28",
        }),
      )
      return yield* http.execute(body ? HttpClientRequest.bodyJsonUnsafe(request, body) : request)
    })

    const snapshot = Effect.fn("ShareNext.snapshot")(function* (sessionID: SessionID) {
      const info = yield* session.get(sessionID)
      const diffs = yield* session.diff(sessionID)
      const messages = yield* session.messages({ sessionID })
      const models = yield* Effect.forEach(
        Array.from(
          new Map(
            messages
              .filter((msg) => msg.info.role === "user")
              .map((msg) => (msg.info as SDK.UserMessage).model)
              .map((item) => [`${item.providerID}/${item.modelID}`, item] as const),
          ).values(),
        ),
        (item) => provider.getModel(ProviderV2.ID.make(item.providerID), ModelV2.ID.make(item.modelID)),
        { concurrency: 8 },
      )
      return RiftShare.snapshot({
        session: info as SDK.Session,
        messages: messages as unknown as RiftShare.Snapshot["messages"],
        diffs: diffs as SDK.SnapshotFileDiff[],
        models: models as unknown as SDK.Model[],
      })
    })

    const files = (snap: RiftShare.Snapshot) => ({ [RiftShare.FILE]: { content: JSON.stringify(snap) } })

    const state: InstanceState.InstanceState<State> = yield* InstanceState.make<State>(
      Effect.fn("ShareNext.state")(function* (ctx) {
        const cache: State = { scope: yield* Scope.make(), shared: new Map(), pending: new Set() }

        yield* Effect.addFinalizer(() =>
          Scope.close(cache.scope, Exit.void).pipe(
            Effect.andThen(
              Effect.sync(() => {
                cache.shared.clear()
                cache.pending.clear()
              }),
            ),
          ),
        )

        if (disabled) return cache

        const watch = <D extends EventV2.Definition>(def: D, fn: (data: EventV2.Data<D>) => Effect.Effect<void, unknown>) =>
          events.listen((event) => {
            if (event.type !== def.type || event.location?.directory !== ctx.directory) return Effect.void
            return fn(event.data as EventV2.Data<D>).pipe(
              Effect.catchCause((cause) => Effect.logError("share subscriber failed", { type: def.type, cause })),
            )
          })

        yield* watch(Session.Event.Updated, (data) => changed(data.info.id))
        yield* watch(MessageV2.Event.Updated, (data) => changed(data.info.sessionID))
        yield* watch(MessageV2.Event.PartUpdated, (data) => changed(data.part.sessionID))
        yield* watch(Session.Event.Diff, (data) => changed(data.sessionID))
        yield* watch(Session.Event.Deleted, (data) => remove(data.sessionID))

        return cache
      }),
    )

    const get = Effect.fnUntraced(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      if (s.shared.has(sessionID)) return s.shared.get(sessionID) ?? undefined
      const row = yield* db
        .select()
        .from(SessionShareTable)
        .where(eq(SessionShareTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      const share = row ? { id: row.id, secret: row.secret, url: row.url } : undefined
      s.shared.set(sessionID, share ?? null)
      return share
    })

    // Mark a shared session dirty; the first change in a burst schedules one rewrite of the gist.
    const changed = Effect.fnUntraced(function* (sessionID: SessionID) {
      if (disabled || !(yield* get(sessionID))) return
      const s = yield* InstanceState.get(state)
      if (s.pending.has(sessionID)) return
      s.pending.add(sessionID)
      yield* flush(sessionID).pipe(
        Effect.delay(DEBOUNCE),
        Effect.catchCause((cause) => Effect.logError("share update failed", { sessionID, cause })),
        Effect.forkIn(s.scope),
      )
    })

    const flush = Effect.fn("ShareNext.flush")(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      s.pending.delete(sessionID)
      const share = yield* get(sessionID)
      if (!share) return
      const res = yield* gist("PATCH", `/gists/${share.id}`, { files: files(yield* snapshot(sessionID)) })
      if (res.status >= 400) yield* Effect.logWarning("failed to update share gist", { sessionID, status: res.status })
    })

    const init = Effect.fn("ShareNext.init")(function* () {
      if (disabled) return
      yield* InstanceState.get(state)
    })

    const url = () => Effect.succeed(RiftShare.VIEWER)

    const create = Effect.fn("ShareNext.create")(function* (sessionID: SessionID) {
      if (disabled) return { id: "", url: "", secret: "" }
      yield* Effect.logInfo("creating share", { sessionID })
      const snap = yield* snapshot(sessionID)
      const res = yield* gist("POST", "/gists", {
        description: `RIFT session · ${snap.session.title}`,
        public: false,
        files: files(snap),
      })
      const created = yield* HttpClientResponse.filterStatusOk(res).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Gist)),
      )
      const result: Share = { id: created.id, url: RiftShare.url(created.id), secret: "" }
      yield* db
        .insert(SessionShareTable)
        .values({ session_id: sessionID, ...result })
        .onConflictDoUpdate({ target: SessionShareTable.session_id, set: result })
        .run()
        .pipe(Effect.orDie)
      const s = yield* InstanceState.get(state)
      s.shared.set(sessionID, result)
      return result
    })

    const remove = Effect.fn("ShareNext.remove")(function* (sessionID: SessionID) {
      if (disabled) return
      yield* Effect.logInfo("removing share", { sessionID })
      const s = yield* InstanceState.get(state)
      const share = yield* get(sessionID)
      if (share) {
        const res = yield* gist("DELETE", `/gists/${share.id}`)
        // Already gone on GitHub is the outcome we wanted.
        if (res.status >= 400 && res.status !== 404) {
          return yield* Effect.fail(new Error(`GitHub refused to delete the share gist (HTTP ${res.status})`))
        }
        yield* db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run().pipe(Effect.orDie)
      }
      s.shared.delete(sessionID)
      s.pending.delete(sessionID)
    })

    return Service.of({ init, url, create, remove })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Database.node, httpClient, Provider.node, Session.node, GitHubToken.node],
})

export * as ShareNext from "./share-next"
