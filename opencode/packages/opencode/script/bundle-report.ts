#!/usr/bin/env bun
// Bundles the CLI the way build.ts does (minified, split) without compiling, and prints the
// largest inputs by bytes contributed to the output.
// usage: bun script/bundle-report.ts [top] [--why <substring>]   (--why prints how a package gets in)
import path from "path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)
const why = process.argv.includes("--why") ? process.argv[process.argv.indexOf("--why") + 1] : undefined
const top = Number(process.argv.find((arg, i) => i > 1 && /^\d+$/.test(arg)) ?? 30)
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

if (why) {
  // Shortest import chain from an entry point to the first input containing `why`.
  const inputs = meta.inputs as Record<string, { imports: { path: string }[] }>
  const entries = ["src/index.ts", "src/cli/tui/worker.ts"]
  // Input keys are relative to the package; import paths are absolute.
  const key = (file: string) => (path.isAbsolute(file) ? path.relative(dir, file) : file)
  const previous = new Map<string, string | undefined>(entries.map((file) => [file, undefined]))
  const queue = [...entries]
  let found: string | undefined
  while (queue.length && !found) {
    const file = queue.shift()!
    for (const item of inputs[file]?.imports ?? []) {
      const next = key(item.path)
      if (previous.has(next)) continue
      previous.set(next, file)
      if (next.includes(why)) {
        found = next
        break
      }
      queue.push(next)
    }
  }
  console.log(`\nwhy ${why}:`)
  const chain: string[] = []
  for (let at = found; at; at = previous.get(at)) chain.unshift(at)
  console.log(chain.length ? chain.map((file) => "  " + file.replace(/.*node_modules\/\.bun\/[^/]+\/node_modules\//, "")).join("\n") : "  not found")
}
