#!/usr/bin/env bun
// Bundles the CLI the way build.ts does (minified, split) without compiling, and prints the
// largest inputs by bytes contributed to the output. usage: bun script/bundle-report.ts [top]
import path from "path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)
const top = Number(process.argv[2] ?? 30)
const generated = await import("./generate.ts")
const pkg = await Bun.file("package.json").json()

const result = await Bun.build({
  conditions: ["bun", "node"],
  tsconfig: "./tsconfig.json",
  plugins: [createSolidTransformPlugin()],
  external: ["node-gyp", "@opentui/core-*", "@parcel/watcher-*", "@ff-labs/fff-bin-*"],
  format: "esm",
  minify: true,
  splitting: true,
  target: "bun",
  outdir: "/tmp/rift-bundle-report",
  metafile: true,
  entrypoints: ["./src/index.ts", "./src/cli/tui/worker.ts"],
  define: {
    FFF_LIBC: JSON.stringify("gnu"),
    OPENCODE_VERSION: `'${pkg.version}'`,
    RIFT_VERSION: `'${pkg.version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OTUI_TREE_SITTER_WORKER_PATH: "x",
    OPENCODE_WORKER_PATH: "./src/cli/tui/worker.ts",
    OPENCODE_CHANNEL: "'local'",
    OPENCODE_LIBC: "",
  },
})
if (!result.success) {
  console.error(result.logs.join("\n"))
  process.exit(1)
}
const meta = (result as any).metafile
const bytes = new Map<string, number>()
let total = 0
for (const out of Object.values<any>(meta.outputs)) {
  for (const [input, info] of Object.entries<any>(out.inputs ?? {})) {
    bytes.set(input, (bytes.get(input) ?? 0) + info.bytesInOutput)
    total += info.bytesInOutput
  }
}
const rows = [...bytes.entries()].sort((a, b) => b[1] - a[1])
console.log(`total output bytes from inputs: ${total}  inputs: ${rows.length}`)
for (const [input, n] of rows.slice(0, top)) console.log(String(n).padStart(10), input)

// Group by package.
const groups = new Map<string, number>()
for (const [input, n] of rows) {
  const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  const key = m ? m[1] : input.split("/").slice(0, 2).join("/")
  groups.set(key, (groups.get(key) ?? 0) + n)
}
console.log("\nby package/dir:")
for (const [k, n] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(String(n).padStart(10), k)
