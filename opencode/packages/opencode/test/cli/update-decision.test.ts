import { describe, expect, test } from "bun:test"
import { decideUpdate } from "../../src/cli/update-decision"

describe("update decision", () => {
  test("asks when a newer release exists, which is the default", () => {
    expect(decideUpdate({ current: "0.1.1", latest: "0.1.2" })).toBe("ask")
    expect(decideUpdate({ current: "0.1.1", latest: "0.2.0" })).toBe("ask")
    expect(decideUpdate({ current: "0.9.0", latest: "1.0.0" })).toBe("ask")
  })

  // The default is to ask because installing software unprompted is the user's decision to make once.
  test("never installs silently unless the user opted in", () => {
    expect(decideUpdate({ current: "0.1.1", latest: "0.1.2", autoupdate: undefined })).toBe("ask")
    expect(decideUpdate({ current: "0.1.1", latest: "0.1.2", autoupdate: "notify" })).toBe("ask")
  })

  test("opting in silences only patch releases; a minor or major still asks", () => {
    expect(decideUpdate({ current: "0.1.1", latest: "0.1.2", autoupdate: true })).toBe("auto")
    expect(decideUpdate({ current: "0.1.1", latest: "0.2.0", autoupdate: true })).toBe("ask")
    expect(decideUpdate({ current: "0.1.1", latest: "1.0.0", autoupdate: true })).toBe("ask")
  })

  test("autoupdate false switches it off entirely", () => {
    expect(decideUpdate({ current: "0.1.1", latest: "9.9.9", autoupdate: false })).toBe("none")
  })

  test("does nothing when already on the latest release", () => {
    expect(decideUpdate({ current: "0.1.2", latest: "0.1.2" })).toBe("none")
    expect(decideUpdate({ current: "0.1.2", latest: "0.1.2", autoupdate: true })).toBe("none")
  })

  // Comparing by inequality would read these as an update and offer to move someone backwards.
  test("never offers to go backwards", () => {
    expect(decideUpdate({ current: "0.2.0", latest: "0.1.9" })).toBe("none")
    expect(decideUpdate({ current: "1.0.0", latest: "0.9.9", autoupdate: true })).toBe("none")
    expect(decideUpdate({ current: "0.1.2-rc.1", latest: "0.1.1" })).toBe("none")
  })

  test("a development build has no release to compare with", () => {
    expect(decideUpdate({ current: "local", latest: "0.1.2" })).toBe("none")
    expect(decideUpdate({ current: "0.1.1", latest: "not-a-version" })).toBe("none")
    expect(decideUpdate({ current: "", latest: "0.1.2" })).toBe("none")
  })

  // The bug this exists to prevent: the binary embedded the OpenCode runtime version (1.18.29) and
  // was compared with RIFT's releases (0.1.x). Any inequality became a "patch", which installed
  // itself, and since the version never changed it did so on every launch. Compared correctly, a
  // runtime-versioned build would be "ahead" of every RIFT release and be left alone.
  test("an OpenCode runtime version is never mistaken for a RIFT release", () => {
    expect(decideUpdate({ current: "1.18.29", latest: "0.1.2" })).toBe("none")
    expect(decideUpdate({ current: "1.18.29", latest: "0.1.2", autoupdate: true })).toBe("none")
  })

  test("the prompt can be forced for testing the dialog", () => {
    expect(decideUpdate({ current: "0.1.2", latest: "0.1.2", alwaysNotify: true })).toBe("ask")
    expect(decideUpdate({ current: "local", latest: "0.1.2", alwaysNotify: true })).toBe("ask")
    // but switching updates off still wins
    expect(decideUpdate({ current: "0.1.1", latest: "0.1.2", autoupdate: false, alwaysNotify: true })).toBe("none")
  })
})
