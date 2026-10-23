import { expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Command } from "../../src/command"
import { DeepResearch } from "../../src/command/deep-research"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Command.node))

it.instance("/deep-research ships as a built-in command that takes a topic", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const command = yield* commands.get("deep-research")
    expect(command?.source).toBe("command")
    expect(command?.hints).toContain("$ARGUMENTS")
  }),
)

it.instance("/deep-research writes its kit and points the prompt at it", () =>
  Effect.sync(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deep-research-"))
    const template = DeepResearch.template(DeepResearch.kit(dir))
    for (const file of ["sources.md", "writing.md", "template.tex", "check.py"]) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true)
    }
    expect(template).not.toContain("${kit}")
    expect(template).toContain(`python3 ${dir}/check.py verify`)
    expect(fs.readFileSync(path.join(dir, "template.tex"), "utf8")).toContain("\\bibliography{refs}")
    fs.rmSync(dir, { recursive: true, force: true })
  }),
)
