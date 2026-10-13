// Opt-in: sends one real "reply with pong" request through the free Zen path.
// RIFT_NETWORK_SMOKE=1 bun test test/guard/smoke.network.test.ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"

const enabled = process.env["RIFT_NETWORK_SMOKE"] === "1"
const model = process.env["RIFT_SMOKE_MODEL"] ?? "opencode/space-bunny-free"

describe("network smoke", () => {
  test.skipIf(!enabled)("rift run replies from a free model", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "rift-smoke-"))
    const entry = process.env["RIFT_SMOKE_BIN"]
    const cmd = entry
      ? [entry, "run", "--model", model, "reply with pong"]
      : ["bun", "run", path.resolve(import.meta.dir, "../../src/index.ts"), "run", "--model", model, "reply with pong"]
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
    const [out] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect(await proc.exited).toBe(0)
    expect(out.toLowerCase()).toContain("pong")
  }, 120_000)
})
