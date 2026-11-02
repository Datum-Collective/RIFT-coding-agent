import { expect, test } from "bun:test"
import { shouldShowGoUpsell } from "../../src/feature-plugins/rift/go-upsell"

test("off by default: RIFT never asks users to pay for OpenCode's own Go subscription", () => {
  expect(shouldShowGoUpsell({})).toBe(false)
})

test("RIFT_GO_UPSELL=1 opts back in, for anyone who wants upstream's behaviour", () => {
  expect(shouldShowGoUpsell({ RIFT_GO_UPSELL: "1" })).toBe(true)
  expect(shouldShowGoUpsell({ RIFT_GO_UPSELL: "true" })).toBe(true)
})

test("any other value, including empty, stays off", () => {
  expect(shouldShowGoUpsell({ RIFT_GO_UPSELL: "0" })).toBe(false)
  expect(shouldShowGoUpsell({ RIFT_GO_UPSELL: "false" })).toBe(false)
  expect(shouldShowGoUpsell({ RIFT_GO_UPSELL: "" })).toBe(false)
})
