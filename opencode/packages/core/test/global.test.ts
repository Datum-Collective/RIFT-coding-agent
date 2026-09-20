import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { BRAND, LEGACY_BRAND, brandedDir } from "@opencode-ai/core/brand"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    // Named for the current brand, or the legacy one when an install from before the rename already
    // has a directory there. Which one exists depends on the machine, so the rule is asserted rather
    // than one outcome of it.
    expect(path.dirname(Global.Path.tmp)).toBe(os.tmpdir())
    expect([BRAND, LEGACY_BRAND]).toContain(path.basename(Global.Path.tmp))
    expect(Global.Path.tmp).toBe(brandedDir(os.tmpdir()))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
