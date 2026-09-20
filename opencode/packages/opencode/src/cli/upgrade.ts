import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { RiftVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { decideUpdate } from "./update-decision"

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
  if (!latest) return

  const action = decideUpdate({
    current: RiftVersion,
    latest,
    autoupdate: config.autoupdate,
    alwaysNotify: Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE,
  })
  if (action === "none") return

  if (action === "ask") {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    .catch(() => {})
}
