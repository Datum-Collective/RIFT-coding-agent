import { expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Command } from "../../src/command"
import { Cad } from "../../src/command/cad"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Command.node))

it.instance("/cad ships as a built-in command that takes a description", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const command = yield* commands.get("cad")
    expect(command?.source).toBe("command")
    expect(command?.hints).toContain("$ARGUMENTS")
  }),
)

it.instance("/cad writes its kit and points the prompt at it", () =>
  Effect.sync(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-"))
    const template = Cad.template(Cad.kit(dir))
    for (const file of ["rules.md", "check.py", "rift_cad.py"]) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true)
    }
    expect(template).not.toContain("${kit}")
    expect(template).toContain(`python3 ${dir}/check.py setup`)
    expect(template).toContain(`python3 ${dir}/check.py verify`)
    expect(template).toContain(`python3 ${dir}/check.py render`)
    expect(template).toContain("graphwrite")
    expect(fs.readFileSync(path.join(dir, "check.py"), "utf8")).toContain("RESULT: PASS")
    fs.rmSync(dir, { recursive: true, force: true })
  }),
)
