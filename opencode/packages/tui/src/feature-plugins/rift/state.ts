/** A session's verification state as the server keeps it: fetched once, then replaced by each change it announces. */
import type { Plugin } from "@opencode/plugin/tui"
import { Rift } from "@opencode/schema/rift"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

/** Undefined while there is no session (home) or nothing has been verified in it yet. */
export function createRiftState(context: Plugin.Context, sessionID: Accessor<string | undefined>) {
  const [state, setState] = createSignal<Rift.State>()
  const rpc = context.client.rpc(Rift.Definition)
  // A change that arrives while a fetch is in flight is newer than its reply.
  const turn = { value: 0 }
  const load = (id: string | undefined) => {
    if (!id) return
    const current = ++turn.value
    const directory = context.data.session.get(id)?.location.directory
    void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
      (next) => {
        if (current === turn.value && sessionID() === id) setState(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== sessionID()) return
      turn.value++
      setState(event.data.state)
    }),
  )
  onCleanup(context.data.on("server.connected", () => load(sessionID())))
  createEffect(
    on(sessionID, (id) => {
      setState(undefined)
      load(id)
    }),
  )
  return state
}
