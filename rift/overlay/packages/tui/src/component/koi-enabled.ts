import { useStorage } from "../context/storage"

/** RIFT_NO_ANIMATION turns the koi off with any value but the plain "no" words: 0, false, no, off or empty. */
export function animationOff(env: Record<string, string | undefined>) {
  const value = (env["RIFT_NO_ANIMATION"] ?? "").toLowerCase()
  return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off"
}

/** The koi are on until the user turns them off. */
export function useKoiEnabled() {
  const [settings] = useStorage().store<{ koi: boolean }>("rift-animation", { initial: { koi: true } })
  return () => settings.koi && !animationOff(process.env)
}
