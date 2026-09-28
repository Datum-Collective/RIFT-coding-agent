import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { collect, embedded } from "../../src/video/template"
import { findWorkspace, scaffold } from "../../src/video/scaffold"

const ENGINE = path.resolve(import.meta.dir, "../../../../../video")

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "rift-video-"))
}

describe("video engine", () => {
  test("the engine embedded in RIFT matches video/ in this repo", async () => {
    const onDisk = await collect(ENGINE)
    const shipped = embedded()
    // If this fails, regenerate: bun run script/video-template.ts
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(onDisk).sort())
    expect(shipped).toEqual(onDisk)
    expect(Object.keys(shipped).some((file) => file.startsWith("node_modules/") || file.startsWith("out/"))).toBe(false)
  })

  test("init writes a working engine into video/, fonts intact", async () => {
    const root = await tmp()
    const result = await scaffold(root)
    expect(result).toEqual({ dir: path.join(root, "video"), created: true })
    expect(await Bun.file(path.join(root, "video/package.json")).json()).toMatchObject({ name: "rift-video" })
    const font = await Bun.file(path.join(root, "video/public/fonts/Inter-400.woff2")).bytes()
    const original = await Bun.file(path.join(ENGINE, "public/fonts/Inter-400.woff2")).bytes()
    expect(Buffer.compare(Buffer.from(font), Buffer.from(original))).toBe(0)
    expect(await findWorkspace(root)).toBe(path.join(root, "video"))
  })

  test("running init again keeps the videos already made", async () => {
    const root = await tmp()
    await scaffold(root)
    await Bun.write(path.join(root, "video/src/data/videoSpecs/mine.ts"), "// my video")
    expect(await scaffold(root)).toEqual({ dir: path.join(root, "video"), created: false })
    expect(await Bun.file(path.join(root, "video/src/data/videoSpecs/mine.ts")).text()).toBe("// my video")
  })

  test("a project's own video/ folder is left alone; the engine goes to .rift/video", async () => {
    const root = await tmp()
    await Bun.write(path.join(root, "video/intro.mp4"), "not ours")
    const result = await scaffold(root)
    expect(result.dir).toBe(path.join(root, ".rift/video"))
    expect(await Bun.file(path.join(root, "video/intro.mp4")).text()).toBe("not ours")
    expect(await findWorkspace(root)).toBe(path.join(root, ".rift/video"))
  })

  test("an explicit directory that holds something else is refused", async () => {
    const root = await tmp()
    await Bun.write(path.join(root, "clips/a.txt"), "x")
    await expect(scaffold(root, { dir: "clips" })).rejects.toThrow(/not empty/)
  })
})
