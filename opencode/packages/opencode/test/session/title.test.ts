import { describe, expect, test } from "bun:test"
import { fallbackTitle } from "../../src/session/title"

describe("fallbackTitle", () => {
  test("uses the first line of what the user typed", () => {
    expect(fallbackTitle("fix the login redirect\nit loops forever")).toBe("Fix the login redirect")
  })

  test("cuts long messages at a word boundary", () => {
    const title = fallbackTitle("please refactor the payment service so that retries no longer double charge customers")!
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith("…")).toBe(true)
    expect(title).toBe("Please refactor the payment service so that retries no…")
  })

  test("skips a leading slash command and blank lines", () => {
    expect(fallbackTitle("\n\n/review the auth changes")).toBe("The auth changes")
  })

  test("has nothing to offer for empty input", () => {
    expect(fallbackTitle("   \n ")).toBeUndefined()
    expect(fallbackTitle("/help")).toBeUndefined()
  })
})
