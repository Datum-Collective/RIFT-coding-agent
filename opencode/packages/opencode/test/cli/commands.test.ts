import { describe, expect, test } from "bun:test"
import { commands, select } from "../../src/cli/commands"

describe("command table", () => {
  for (const entry of commands) {
    test(`${entry.command} matches its module`, async () => {
      const real = (await entry.load()) as { command: string; describe: string; aliases?: string[] }
      expect(entry.command).toBe(real.command)
      expect(entry.describe).toBe(real.describe)
      expect(entry.aliases ?? []).toEqual(real.aliases ?? [])
    })
  }

  test("selects by name and alias, ignoring global flags", () => {
    expect(select(["run", "hello"])?.name).toBe("run")
    expect(select(["--print-logs", "--log-level", "DEBUG", "models"])?.name).toBe("models")
    expect(select(["auth", "list"])?.name).toBe("providers")
  })

  test("no command for a project path, flags only, or nothing", () => {
    expect(select([])).toBeUndefined()
    expect(select(["--model", "x/y"])).toBeUndefined()
    expect(select(["./some/dir"])).toBeUndefined()
  })
})

describe("option values", () => {
  test("a value that looks like a command is not a command", () => {
    expect(select(["--model", "run"])).toBeUndefined()
    expect(select(["-m", "opencode/x", "run"])?.name).toBe("run")
  })
})
