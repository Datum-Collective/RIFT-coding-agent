import { beforeEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"

import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { GitHubToken } from "@/share/github-token"
import { RiftShare } from "@/share/rift-share"
import { SessionShareTable } from "@opencode-ai/core/share/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const GIST = "8f3a0c1d2e4b5a69788f0a1b2c3d4e5f"

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  )

const body = (req: HttpClientRequest.HttpClientRequest) =>
  req.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(req.body.body)) : undefined

const signedIn = Layer.succeed(
  GitHubToken.Service,
  GitHubToken.Service.of({ get: () => Effect.succeed("ghp_test"), forget: () => Effect.void }),
)
const signedOut = Layer.succeed(
  GitHubToken.Service,
  GitHubToken.Service.of({ get: () => Effect.fail(new GitHubToken.MissingTokenError()), forget: () => Effect.void }),
)

function layer(client: HttpClient.HttpClient, token = signedIn) {
  return LayerNode.compile(
    LayerNode.group([ShareNext.node, EventV2Bridge.node, Session.node, SessionProjector.node, Database.node]),
    [
      [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
      [GitHubToken.node, token],
    ],
  )
}

const row = (id: SessionID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return yield* database.db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const newSession = (title: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* sessions.create({ title })
  })

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("create saves the session as a secret gist and returns a RIFT viewer link", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        seen.push(req)
        return Effect.succeed(json(req, { id: GIST, html_url: `https://gist.github.com/${GIST}` }, 201))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("Fix flaky upload test")
        const share = yield* ShareNext.Service

        const result = yield* share.create(session.id)

        expect(result.id).toBe(GIST)
        expect(result.url).toBe(RiftShare.url(GIST))
        expect((yield* row(session.id))?.url).toBe(RiftShare.url(GIST))

        const create = seen[0]
        expect([create.method, create.url]).toEqual(["POST", "https://api.github.com/gists"])
        expect(create.headers["authorization"]).toBe("Bearer ghp_test")
        const sent = body(create)
        expect(sent.public).toBe(false)
        expect(sent.description).toBe("RIFT session · Fix flaky upload test")
        const snap = JSON.parse(sent.files[RiftShare.FILE].content)
        expect(snap.format).toBe("rift-share")
        expect(snap.session.id).toBe(session.id)
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("the link comes from a tiny placeholder, and the full session uploads right after", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        seen.push(req)
        return Effect.succeed(json(req, { id: GIST }, req.method === "POST" ? 201 : 200))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("Big session")
        const share = yield* ShareNext.Service

        yield* share.create(session.id)

        // Only the placeholder has gone out when the link comes back.
        const created = JSON.parse(body(seen[0]).files[RiftShare.FILE].content)
        expect(created.pending).toBe(true)
        expect(created.messages).toEqual([])

        // The full session follows without waiting for the edit debounce.
        yield* pollWithTimeout(
          Effect.sync(() => (seen.some((req) => req.method === "PATCH") ? true : undefined)),
          "the full session was never uploaded",
          "3 seconds",
        )
        const full = JSON.parse(body(seen.find((req) => req.method === "PATCH")!).files[RiftShare.FILE].content)
        expect(full.pending).toBeUndefined()
        expect(full.session.id).toBe(session.id)
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("pressing share twice while the first is still creating makes one gist, not two", () =>
    provideTmpdirInstance(() => {
      const posts: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        if (req.method === "POST") posts.push(req)
        // GitHub is slow to create gists; the second press lands while the first is in flight.
        return Effect.succeed(json(req, { id: GIST }, 201)).pipe(Effect.delay(req.method === "POST" ? "200 millis" : "0 millis"))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        const [first, second] = yield* Effect.all([share.create(session.id), share.create(session.id)], {
          concurrency: "unbounded",
        })

        expect(second.url).toBe(first.url)
        expect(posts).toHaveLength(1)
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("sharing an already shared session returns the same link instead of a second gist", () =>
    provideTmpdirInstance(() => {
      const posts: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        if (req.method === "POST") posts.push(req)
        return Effect.succeed(json(req, { id: GIST }, 201))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        const first = yield* share.create(session.id)
        const second = yield* share.create(session.id)

        expect(second.url).toBe(first.url)
        expect(posts).toHaveLength(1)
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("a session shared through opencode's old service gets a RIFT gist, not its old link", () =>
    provideTmpdirInstance(() => {
      const posts: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        if (req.method === "POST") posts.push(req)
        return Effect.succeed(json(req, { id: GIST }, 201))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const database = yield* Database.Service
        yield* database.db
          .insert(SessionShareTable)
          .values({ session_id: session.id, id: "E8Kd7AR0", url: "https://opncd.ai/share/E8Kd7AR0", secret: "s" })
          .run()
          .pipe(Effect.orDie)
        const share = yield* ShareNext.Service

        const result = yield* share.create(session.id)

        expect(result.url).toBe(RiftShare.url(GIST))
        expect(posts).toHaveLength(1)
        expect((yield* row(session.id))?.url).toBe(RiftShare.url(GIST))
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("opencode share links left from before are cleared when sharing starts up", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make(() => Effect.die("unexpected http call"))
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* newSession("test")
        yield* sessions.setShare({ sessionID: session.id, share: { url: "https://opncd.ai/share/E8Kd7AR0" } })
        const database = yield* Database.Service
        yield* database.db
          .insert(SessionShareTable)
          .values({ session_id: session.id, id: "E8Kd7AR0", url: "https://opncd.ai/share/E8Kd7AR0", secret: "s" })
          .run()
          .pipe(Effect.orDie)
        const share = yield* ShareNext.Service

        yield* share.init()

        expect(yield* row(session.id)).toBeUndefined()
        expect((yield* sessions.get(session.id)).share).toBeUndefined()
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("create explains how to sign in when there is no GitHub token", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make(() => Effect.die("unexpected http call"))
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        const exit = yield* Effect.exit(share.create(session.id))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("gh auth login")
        expect(yield* row(session.id)).toBeUndefined()
      }).pipe(Effect.provide(layer(client, signedOut)))
    }),
  )

  it.live("a token GitHub rejects is dropped, so signing in again works without a restart", () =>
    provideTmpdirInstance(() => {
      let forgotten = 0
      const stale = Layer.succeed(
        GitHubToken.Service,
        GitHubToken.Service.of({
          get: () => Effect.succeed("ghp_revoked"),
          forget: () =>
            Effect.sync(() => {
              forgotten++
            }),
        }),
      )
      const client = HttpClient.make((req) => Effect.succeed(json(req, { message: "Bad credentials" }, 401)))
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        yield* Effect.exit(share.create(session.id))

        expect(forgotten).toBe(1)
      }).pipe(Effect.provide(layer(client, stale)))
    }),
  )

  it.live(
    "a GitHub request that never answers fails with a clear message instead of hanging",
    () =>
      provideTmpdirInstance(() => {
        const client = HttpClient.make(() => Effect.never)
        return Effect.gen(function* () {
          const session = yield* newSession("test")
          const share = yield* ShareNext.Service

          const exit = yield* Effect.exit(share.create(session.id))

          expect(Exit.isFailure(exit)).toBe(true)
          expect(String(exit)).toContain("didn't answer in time")
          expect(yield* row(session.id)).toBeUndefined()
        }).pipe(Effect.provide(layer(client)))
      }),
    // The request limit is the behaviour under test, and it is longer than bun's default timeout.
    30_000,
  )

  it.live(
    "unshare still finishes when GitHub deleted the gist but the answer got lost",
    () =>
      provideTmpdirInstance(() => {
        let deletes = 0
        const client = HttpClient.make((req) => {
          if (req.method === "POST") return Effect.succeed(json(req, { id: GIST }, 201))
          if (req.method !== "DELETE") return Effect.succeed(json(req, { id: GIST }))
          deletes++
          // The first delete lands on GitHub but its answer never arrives; the retry sees it gone.
          return deletes === 1 ? Effect.never : Effect.succeed(json(req, { message: "Not Found" }, 404))
        })
        return Effect.gen(function* () {
          const session = yield* newSession("test")
          const share = yield* ShareNext.Service

          yield* share.create(session.id)
          yield* share.remove(session.id)

          expect(deletes).toBe(2)
          expect(yield* row(session.id)).toBeUndefined()
        }).pipe(Effect.provide(layer(client)))
      }),
    30_000,
  )

  it.live("create fails on a GitHub error and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { message: "Bad credentials" }, 401)))
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        const exit = yield* Effect.exit(share.create(session.id))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* row(session.id)).toBeUndefined()
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("remove deletes the gist and forgets the share", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        seen.push(req)
        if (req.method === "POST") return Effect.succeed(json(req, { id: GIST }, 201))
        return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 204 })))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        yield* share.create(session.id)
        yield* share.remove(session.id)

        expect(yield* row(session.id)).toBeUndefined()
        expect(seen.map((req) => [req.method, req.url])).toContainEqual([
          "DELETE",
          `https://api.github.com/gists/${GIST}`,
        ])
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("remove still forgets the share when the gist was already deleted on GitHub", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => {
        if (req.method === "POST") return Effect.succeed(json(req, { id: GIST }, 201))
        return Effect.succeed(json(req, { message: "Not Found" }, 404))
      })
      return Effect.gen(function* () {
        const session = yield* newSession("test")
        const share = yield* ShareNext.Service

        yield* share.create(session.id)
        yield* share.remove(session.id)

        expect(yield* row(session.id)).toBeUndefined()
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("download reads a shared session back from its gist", () =>
    provideTmpdirInstance(() => {
      const snap = RiftShare.snapshot({
        session: { id: "ses_shared", title: "Shared", time: { created: 1, updated: 2 } } as never,
        messages: [],
        diffs: [],
        models: [],
      })
      const client = HttpClient.make((req) =>
        Effect.succeed(json(req, { id: GIST, files: { [RiftShare.FILE]: { content: JSON.stringify(snap) } } })),
      )
      return Effect.gen(function* () {
        const share = yield* ShareNext.Service

        const out = yield* share.download(GIST)

        expect(out?.info.id).toBe("ses_shared")
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("download says a share is still uploading instead of calling it not a RIFT share", () =>
    provideTmpdirInstance(() => {
      const pending = RiftShare.placeholder({ id: "ses_p", title: "p", time: { created: 1, updated: 1 } } as never)
      const client = HttpClient.make((req) =>
        Effect.succeed(json(req, { id: GIST, files: { [RiftShare.FILE]: { content: JSON.stringify(pending) } } })),
      )
      return Effect.gen(function* () {
        const share = yield* ShareNext.Service
        const exit = yield* Effect.exit(share.download(GIST))
        expect(String(exit)).toContain("still uploading")
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live("download finds nothing in a gist RIFT didn't make", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) =>
        Effect.succeed(json(req, { id: GIST, files: { "notes.md": { content: "hi" } } })),
      )
      return Effect.gen(function* () {
        const share = yield* ShareNext.Service
        expect(yield* share.download(GIST)).toBeUndefined()
      }).pipe(Effect.provide(layer(client)))
    }),
  )

  it.live(
    "rapid changes to a shared session become one gist update with the latest state",
    () =>
      provideTmpdirInstance(() => {
        const patches: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.method === "PATCH") patches.push(req)
          return Effect.succeed(json(req, { id: GIST }))
        })
        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const database = yield* Database.Service

          const info = yield* newSession("first")
          yield* share.init()
          yield* database.db
            .insert(SessionShareTable)
            .values({ session_id: info.id, id: GIST, url: RiftShare.url(GIST), secret: "" })
            .run()
            .pipe(Effect.orDie)

          const diff = (file: string) => ({ file, patch: "", additions: 1, deletions: 0, status: "modified" as const })
          yield* events.publish(Session.Event.Diff, { sessionID: info.id, diff: [diff("a.ts")] })
          yield* events.publish(Session.Event.Diff, { sessionID: info.id, diff: [diff("b.ts")] })
          yield* pollWithTimeout(
            Effect.sync(() => (patches.length === 1 ? true : undefined)),
            "timed out waiting for the gist update",
            "15 seconds",
          )

          expect(patches).toHaveLength(1)
          expect(patches[0].url).toBe(`https://api.github.com/gists/${GIST}`)
          const snap = JSON.parse(body(patches[0]).files[RiftShare.FILE].content)
          expect(snap.format).toBe("rift-share")
          expect(snap.session.id).toBe(info.id)
        }).pipe(Effect.provide(layer(client)))
      }),
    // The batching delay is the behaviour under test, and it is longer than bun's default timeout.
    20_000,
  )
})
