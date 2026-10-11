import { fromModelsDevProvider, toPublicInfo } from "../../src/provider/provider"
const data = JSON.parse(await Bun.file(process.argv[2]).text())
const catalog = Object.values<any>(data).map((p) => fromModelsDevProvider(p))
for (let i = 0; i < 3; i++) {
  const t = performance.now()
  for (const p of catalog) toPublicInfo(p)
  console.log(`toPublicInfo all ${(performance.now() - t).toFixed(0)} ms`)
}
