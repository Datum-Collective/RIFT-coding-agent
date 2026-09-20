import semver from "semver"

export type UpdateAction =
  /** Nothing to do: up to date, ahead, or not comparable. */
  | "none"
  /** Tell the user and let them choose. */
  | "ask"
  /** Install without asking. Only ever for a patch release, and only when the user opted in. */
  | "auto"

/**
 * What to do about the newest release on GitHub.
 *
 * The default is to ask. Installing software on someone's machine without saying so is a decision
 * for them to make once, in config, not one to assume, so `autoupdate: true` is the only way to get
 * silent installs, and even then a minor or major release still asks.
 *
 * "Newer" is decided by semver, not by inequality. Inequality reads a build that is ahead of the
 * latest release (a development build, or a release that was yanked) as an update available, and would
 * offer to "update" someone backwards.
 */
export function decideUpdate(input: {
  current: string
  latest: string
  /** The `autoupdate` config value. Unset means ask. */
  autoupdate?: boolean | "notify"
  /** Show the prompt even when nothing is newer, for testing the dialog. */
  alwaysNotify?: boolean
}): UpdateAction {
  if (input.autoupdate === false) return "none"
  if (input.alwaysNotify) return "ask"

  // A development build reports "local", which is not a release and cannot be compared with one.
  if (!semver.valid(input.current) || !semver.valid(input.latest)) return "none"
  if (!semver.gt(input.latest, input.current)) return "none"

  if (input.autoupdate === true && semver.diff(input.current, input.latest) === "patch") return "auto"
  return "ask"
}
