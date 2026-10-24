import { expect, test } from "bun:test"
import { Permission } from "../../src/permission"

const open = Permission.fromConfig({ "*": "allow" })
const level = (mode: string, permission: string, ruleset = open) =>
  Permission.evaluate(permission, "*", Permission.strict(mode, permission, ["*"], ruleset)).action

test("normal and auto leave the rules alone", () => {
  for (const mode of ["normal", "auto", undefined, "nonsense"]) {
    expect(level(mode as string, "edit")).toBe("allow")
    expect(level(mode as string, "bash")).toBe("allow")
  }
})

test("ask mode asks before edits and shell commands, not reads", () => {
  expect(level("ask", "edit")).toBe("ask")
  expect(level("ask", "bash")).toBe("ask")
  expect(level("ask", "read")).toBe("allow")
})

test("accept-edits mode only asks before shell commands", () => {
  expect(level("edits", "edit")).toBe("allow")
  expect(level("edits", "bash")).toBe("ask")
})

test("a stricter mode never loosens a deny", () => {
  const plan = Permission.fromConfig({ "*": "allow", edit: { "*": "deny" } })
  expect(level("ask", "edit", plan)).toBe("deny")
})
