declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
  const RIFT_VERSION: string
}

/**
 * The version of the OpenCode runtime this build is based on. Provider APIs, plugins and telemetry
 * care about this one, so it stays the upstream number even though RIFT ships its own releases.
 */
export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

/**
 * The RIFT release this build was cut as, the tag the release was published under (0.1.2, not the
 * runtime's 1.18.x). Anything that compares "what I am" with "what is on GitHub" must use this: the
 * releases are RIFT's, so comparing them with the runtime version is comparing unrelated numbers,
 * which reads as a permanent update available.
 */
export const RiftVersion = typeof RIFT_VERSION === "string" ? RIFT_VERSION : "local"
