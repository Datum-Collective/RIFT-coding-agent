import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

/** normal: RIFT's defaults. ask: also asks before edits and commands. edits: asks before commands. auto: approves everything. */
export type PermissionMode = "normal" | "ask" | "edits" | "auto"

export const PERMISSION_MODES: readonly PermissionMode[] = ["normal", "edits", "ask", "auto"]

export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  normal: "normal",
  edits: "accept edits",
  ask: "ask first",
  auto: "auto",
}

/** The key the server reads the mode from on the session's metadata. */
export const PERMISSION_MODE_KEY = "permission_mode"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: args.auto ? "auto" : "normal",
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
      },
      cycle(direction: 1 | -1 = 1) {
        const at = PERMISSION_MODES.indexOf(store.mode)
        const next = PERMISSION_MODES[(at + direction + PERMISSION_MODES.length) % PERMISSION_MODES.length]
        setStore("mode", next)
        return next
      },
      toggle() {
        setStore("mode", (mode) => (mode === "auto" ? "normal" : "auto"))
      },
    }
  },
})
