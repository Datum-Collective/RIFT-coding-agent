import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { RiftVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { decideUpdate } from "./update-decision"

/**
 * The release the user should be asked about, once one has been found. The event announcing it is sent
 * once and dropped if nobody is listening, and the interface only starts listening when it has finished
 * loading, which on a slow machine or a first run can be after the check is done. Remembering the result
 * lets the interface ask for it the moment it subscribes, so the prompt no longer depends on which side
 * happens to be ready first.
 */
let pending: string | undefined

/** The newest release already acted on, so a later check does not announce or install it a second time. */
let handled: string | undefined

function announce(version: string) {
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Installation.Event.UpdateAvailable.type,
      properties: { version },
    },
  })
}

/** Sends the pending update announcement again, for an interface that subscribed after it was made. */
export function replayUpdate() {
  if (pending) announce(pending)
}

/**
 * Checks GitHub for a newer RIFT release when the app starts, and either tells the interface to ask
 * the user or, for someone who opted in, installs a patch release quietly.
 */
export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return

  // RIFT is only published through its own installer. Any other detected method belongs to a
  // different product, such as an OpenCode package, and asking one of those for "latest" would offer
  // the wrong software.
  const method = await Installation.method()
  if (method !== "curl") return

  const latest = await Installation.latest(method).catch(() => {})
  if (!latest || latest === handled) return

  const action = decideUpdate({
    current: RiftVersion,
    latest,
    autoupdate: config.autoupdate,
    alwaysNotify: Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE,
  })
  if (action === "none") return

  if (action === "ask") {
    pending = latest
    handled = latest
    announce(latest)
    return
  }

  await Installation.upgrade(method, latest)
    .then(() => {
      // The running binary is still the old one until restart, so without this every later check
      // would find the same "newer" release and install it again.
      handled = latest
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      })
    })
    .catch(() => {})
}

/** How often a running RIFT looks for a new release. Long sessions are common; one check at launch is not enough. */
export const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000

let watching = false

/**
 * Checks now, then keeps checking while RIFT stays open, so a release published mid-session still
 * reaches the user. Safe to call more than once. A check that is still running is never overlapped,
 * and failures (offline, GitHub down) are silent and simply tried again next time.
 */
export function watchForUpdates(interval = UPDATE_CHECK_INTERVAL, run: () => Promise<void> = upgrade) {
  if (watching) return
  watching = true
  let running = false
  const check = async () => {
    if (running) return
    running = true
    await run().catch(() => {})
    running = false
  }
  void check()
  // unref: the watcher alone must never keep the process alive.
  setInterval(check, interval).unref()
}
