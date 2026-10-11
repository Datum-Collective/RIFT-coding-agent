import { fromModelsDevProvider } from "../../src/provider/provider"
const data = JSON.parse(await Bun.file(process.argv[2]).text())
const providers = Object.keys(data).length
const models = Object.values<any>(data).reduce((n, p) => n + Object.keys(p.models).length, 0)
for (let i = 0; i < 3; i++) {
  const t = performance.now()
  for (const p of Object.values<any>(data)) fromModelsDevProvider(p)
  console.log(`${providers} providers, ${models} models: fromModelsDevProvider all ${(performance.now() - t).toFixed(0)} ms`)
}
const t2 = performance.now(); const d = JSON.parse(await Bun.file(process.argv[2]).text()); console.log(`JSON.parse ${(performance.now() - t2).toFixed(0)} ms`)
