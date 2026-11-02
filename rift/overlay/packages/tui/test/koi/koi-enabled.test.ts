import { expect, test } from "bun:test"
import { koiEnabled } from "../../src/component/koi-enabled"

test("on by default: config.animations unset, storage unset, no env override", () => {
  expect(koiEnabled({ animations: undefined, koi: true, env: {} })).toBe(true)
})

test("upstream's own test fixtures turn animations off to keep renders settling, and koi must respect that too", () => {
  // test/fixture/app.ts defaults config to { animations: false } for exactly this reason.
  expect(koiEnabled({ animations: false, koi: true, env: {} })).toBe(false)
})

test("the per-user koi toggle (/background) still works when animations are otherwise on", () => {
  expect(koiEnabled({ animations: true, koi: false, env: {} })).toBe(false)
  expect(koiEnabled({ animations: undefined, koi: false, env: {} })).toBe(false)
})

test("RIFT_NO_ANIMATION overrides everything, as it always has", () => {
  expect(koiEnabled({ animations: true, koi: true, env: { RIFT_NO_ANIMATION: "1" } })).toBe(false)
})

test("RIFT_NO_ANIMATION=no, 0, false, off and empty all mean animations stay on", () => {
  for (const value of ["no", "0", "false", "off", ""]) {
    expect(koiEnabled({ animations: true, koi: true, env: { RIFT_NO_ANIMATION: value } })).toBe(true)
  }
})
