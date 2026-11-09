import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { App } from "../../src/app.js"

const upstream = JSON.parse(readFileSync(path.resolve(import.meta.dir, "../../../../../rift/upstream.json"), "utf8")).version.replace(/^v/, "")

const semver = (version: string) => version.split(".").map(Number) as [number, number, number]
const atLeast = (version: string, floor: string) => {
  const [a, b] = [semver(version), semver(floor)]
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2]
}

describe("the user agent RIFT sends to OpenCode's hosted services", () => {
  const rift = App.make({ name: "rift", version: "0.6.0", channel: "latest" })

  test("reports the OpenCode release RIFT is built on, so the free tier's minimum version is met", () => {
    const [, channel, version, name] = App.useragent(rift).split("/")
    expect(version).toBe(upstream)
    expect(atLeast(version!, "1.18.0")).toBe(true)
    expect({ channel, name }).toEqual({ channel: "latest", name: "rift" })
  })

  test("keeps the four-part shape the Console parses and does not depend on RIFT's own version", () => {
    expect(App.useragent(rift).split("/")).toHaveLength(4)
    expect(App.useragent(App.make({ name: "rift", version: "0.0.1", channel: "latest" }))).toBe(App.useragent(rift))
  })
})
