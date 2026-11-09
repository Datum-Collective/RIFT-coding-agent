import { useConfig } from "../config"
import { useStorage } from "../context/storage"

/** RIFT_NO_ANIMATION turns the koi off with any value but the plain "no" words: 0, false, no, off or empty. */
export function animationOff(env: Record<string, string | undefined>) {
  const value = (env["RIFT_NO_ANIMATION"] ?? "").toLowerCase()
  return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off"
}

/**
 * Combines every source that turns the koi off: the project/user `animations` config (which upstream's own test
 * fixtures set to `false` by default, so a render can settle without an animation running), the `/background`
 * koi toggle, and RIFT_NO_ANIMATION. Koi is on by default; any one of these can turn it off.
 */
export function koiEnabled(input: { animations: boolean | undefined; koi: boolean; env: Record<string, string | undefined> }) {
  return (input.animations ?? true) && input.koi && !animationOff(input.env)
}

/** The koi are on until something turns them off: config, the user, or the environment. */
export function useKoiEnabled() {
  const config = useConfig()
  const [settings] = useStorage().store<{ koi: boolean }>("rift-animation", { initial: { koi: true } })
  return () => koiEnabled({ animations: config.data.animations, koi: settings.koi, env: process.env })
}
