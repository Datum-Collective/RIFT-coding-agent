import { expect, test } from "bun:test"
import { fitShortcuts, fitTitle, promptTitle, tokenBudget } from "../../src/feature-plugins/rift/format"

test("token budget reads like 9.5K / 500K", () => {
  expect(tokenBudget(9_500, 500_000)).toBe("9.5K / 500K")
  expect(tokenBudget(842, 200_000)).toBe("842 / 200K")
  expect(tokenBudget(1_250_000, 2_000_000)).toBe("1.3M / 2M")
})

test("token budget without a known limit shows only what was used", () => {
  expect(tokenBudget(9_500, undefined)).toBe("9.5K")
})

test("shortcuts keep their order and drop from the end when the row is too narrow", () => {
  const all = [
    { key: "tab", label: "agents" },
    { key: "ctrl+p", label: "commands" },
    { key: "ctrl+l", label: "log" },
  ]
  expect(fitShortcuts(all, 80).map((item) => item.label)).toEqual(["agents", "commands", "log"])
  expect(fitShortcuts(all, 28).map((item) => item.label)).toEqual(["agents", "commands"])
  expect(fitShortcuts(all, 3)).toEqual([])
})

test("the prompt title names the model, its effort and the mode", () => {
  expect(promptTitle({ model: "Claude Sonnet 5", variant: "high", agent: "build" })).toBe("Claude Sonnet 5 (high) · build")
  expect(promptTitle({ model: "Claude Sonnet 5", agent: "plan", auto: true })).toBe("Claude Sonnet 5 · plan · auto")
  expect(promptTitle({ agent: "build" })).toBe("build")
  expect(promptTitle({ agent: "build", limit: "5h 40%" })).toBe("build · 5h 40%")
})

test("a value just under a million rounds up to the next unit", () => {
  expect(tokenBudget(999_950, undefined)).toBe("1M")
})

test("in shell mode the prompt title names only the shell", () => {
  expect(promptTitle({ model: "Claude Sonnet 5", variant: "high", agent: "Shell", auto: true, shell: true })).toBe("Shell")
})

test("a title that does not fit is cut, never lost", () => {
  expect(fitTitle("Claude Sonnet 5 (high) · build", 16)).toBe(" Claude Sonn… ")
  expect(fitTitle("short", 40)).toBe(" short ")
  expect(fitTitle("", 40)).toBeUndefined()
  expect(fitTitle("anything", 3)).toBeUndefined()
})
