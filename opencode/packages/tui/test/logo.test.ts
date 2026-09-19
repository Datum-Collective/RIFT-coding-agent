import { expect, test } from "bun:test"
import { go, logo } from "../src/logo"

test("wordmark halves are rectangular so the home screen cannot misalign", () => {
  for (const half of [logo.left, logo.right, go.left, go.right]) {
    const widths = new Set(half.map((line) => [...line].length))
    expect(widths.size).toBe(1)
  }
  expect(logo.left.length).toBe(logo.right.length)
  expect([...logo.left[1]!].length).toBe([...logo.right[1]!].length)
})
