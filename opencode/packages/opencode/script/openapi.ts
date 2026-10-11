// Prints the server's OpenAPI document. The SDK build (packages/sdk/js/script/build.ts) runs this
// to regenerate the typed client; it replaces the old `generate` CLI command, which shipped in the
// binary for no user-facing reason.
import { Server } from "../src/server/server"

const specs = (await Server.openapi()) as { paths: Record<string, Record<string, any>> }
for (const item of Object.values(specs.paths)) {
  for (const method of ["get", "post", "put", "delete", "patch"] as const) {
    const operation = item[method]
    if (!operation?.operationId) continue
    operation["x-codeSamples"] = [
      {
        lang: "js",
        source: [
          `import { createOpencodeClient } from "@opencode-ai/sdk`,
          ``,
          `const client = createOpencodeClient()`,
          `await client.${operation.operationId}({`,
          `  ...`,
          `})`,
        ].join("\n"),
      },
    ]
  }
}
const prettier = await import("prettier")
const babel = await import("prettier/plugins/babel")
const estree = await import("prettier/plugins/estree")
const json = await prettier.format(JSON.stringify(specs, null, 2), {
  parser: "json",
  plugins: [babel.default ?? babel, estree.default ?? estree],
  printWidth: 120,
})
await new Promise<void>((resolve, reject) => process.stdout.write(json, (err) => (err ? reject(err) : resolve())))
process.exit(0)
