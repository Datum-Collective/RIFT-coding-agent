import { describe, expect, test } from "bun:test"
import { CdpSession } from "../../src/browser/cdp"

describe("CdpSession", () => {
  test("a command the browser never answers fails instead of hanging", async () => {
    const cdp = new CdpSession(() => {})
    const started = Date.now()
    await expect(cdp.command("Page.navigate", { url: "about:blank" }, undefined, 50)).rejects.toThrow(
      "browser did not answer Page.navigate",
    )
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test("an answered command resolves with its result", async () => {
    const sent: string[] = []
    const cdp = new CdpSession((payload) => sent.push(payload))
    const pending = cdp.command("Browser.getVersion")
    cdp.receive(JSON.stringify({ id: JSON.parse(sent[0]!).id, result: { product: "Chrome" } }))
    expect(await pending).toEqual({ product: "Chrome" })
  })

  test("a failed send rejects the command at once", async () => {
    const cdp = new CdpSession(() => {
      throw new Error("pipe closed")
    })
    await expect(cdp.command("Browser.getVersion")).rejects.toThrow("pipe closed")
  })
})
