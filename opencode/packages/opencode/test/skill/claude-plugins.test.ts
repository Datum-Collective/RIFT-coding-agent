import { expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { claudePluginSkillDirs } from "../../src/skill"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(FSUtil.node))

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

it.live("reads skills from installed Claude Code plugins, honouring plugin.json", () =>
  Effect.gen(function* () {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rift-claude-plugins-"))
    const listed = path.join(home, "cache", "listed", "1.0.0")
    const plain = path.join(home, "cache", "plain", "2.0.0")
    write(
      path.join(listed, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "listed", skills: ["./skills/keep", "../../escape"] }),
    )
    write(path.join(listed, "skills", "keep", "SKILL.md"), "---\nname: keep\ndescription: k\n---\n")
    write(path.join(listed, "skills", "deprecated", "old", "SKILL.md"), "---\nname: old\ndescription: o\n---\n")
    write(path.join(home, "cache", "escape", "SKILL.md"), "x")
    write(path.join(plain, "skills", "remotion-create", "SKILL.md"), "---\nname: remotion-create\ndescription: r\n---\n")
    write(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "listed@market": [{ installPath: listed }],
          "remotion@remotion": [{ installPath: plain }],
          "missing@market": [{ installPath: path.join(home, "nope") }],
        },
      }),
    )

    const fsys = yield* FSUtil.Service
    const dirs = yield* claudePluginSkillDirs(fsys, home)
    expect(dirs).toEqual([
      { root: path.join(listed, "skills", "keep"), pattern: "SKILL.md" },
      { root: path.join(plain, "skills"), pattern: "**/SKILL.md" },
    ])
    expect(yield* claudePluginSkillDirs(fsys, path.join(home, "no-claude"))).toEqual([])
    fs.rmSync(home, { recursive: true, force: true })
  }),
)
