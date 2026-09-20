import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { findCommandLinks } from "../../src/cli/cmd/uninstall"

const made: string[] = []
async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rift-links-"))
  made.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of made.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function install(root: string) {
  const bin = path.join(root, ".rift", "bin")
  await fs.mkdir(bin, { recursive: true })
  await fs.writeFile(path.join(bin, "rift"), "#!/bin/sh\n", { mode: 0o755 })
  await fs.symlink("rift", path.join(bin, "opencode"))
  return path.join(bin, "rift")
}

describe("command links", () => {
  test("finds the links the installer made, including the opencode alias that goes through rift", async () => {
    const root = await tmp()
    const binary = await install(root)
    const dir = path.join(root, "local-bin")
    await fs.mkdir(dir)
    await fs.symlink(binary, path.join(dir, "rift"))
    await fs.symlink(path.join(root, ".rift", "bin", "opencode"), path.join(dir, "opencode"))

    const found = await findCommandLinks(binary, [dir])
    expect(found.sort()).toEqual([path.join(dir, "opencode"), path.join(dir, "rift")].sort())
  })

  // Uninstalling must never remove another tool's command just because it shares a name.
  test("leaves an unrelated opencode alone", async () => {
    const root = await tmp()
    const binary = await install(root)
    const dir = path.join(root, "homebrew-bin")
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, "real-opencode"), "upstream")
    await fs.symlink("real-opencode", path.join(dir, "opencode"))

    expect(await findCommandLinks(binary, [dir])).toEqual([])
  })

  test("leaves a regular file of the same name alone", async () => {
    const root = await tmp()
    const binary = await install(root)
    const dir = path.join(root, "bin")
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, "rift"), "someone else's script")

    expect(await findCommandLinks(binary, [dir])).toEqual([])
  })

  test("ignores a dangling link, and missing directories", async () => {
    const root = await tmp()
    const binary = await install(root)
    const dir = path.join(root, "bin")
    await fs.mkdir(dir)
    await fs.symlink(path.join(root, "gone"), path.join(dir, "rift"))

    expect(await findCommandLinks(binary, [dir, path.join(root, "does-not-exist")])).toEqual([])
  })

  test("finds nothing when there are no links", async () => {
    const root = await tmp()
    const binary = await install(root)
    expect(await findCommandLinks(binary, [path.join(root, "empty")])).toEqual([])
  })
})
