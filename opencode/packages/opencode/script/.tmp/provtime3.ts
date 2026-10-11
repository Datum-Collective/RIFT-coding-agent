import { Schema } from "effect"
import { fromModelsDevProvider, toPublicInfo, Model } from "../../src/provider/provider"
const data = JSON.parse(await Bun.file(process.argv[2]).text())
const catalog = Object.fromEntries(Object.entries<any>(data).map(([k, p]) => [k, fromModelsDevProvider(p)]))
const all = Object.values(catalog).flatMap((p: any) => Object.values(p.models))
let t = performance.now(); let bad = 0
for (const m of all) if (!Schema.is(Model)(m)) bad++
console.log(`Schema.is over ${all.length} models: ${(performance.now() - t).toFixed(0)} ms, invalid ${bad}`)
const is = Schema.is(Model)
t = performance.now(); for (const m of all) is(m); console.log(`hoisted Schema.is: ${(performance.now() - t).toFixed(0)} ms`)
t = performance.now(); JSON.parse(JSON.stringify(catalog)); console.log(`JSON round trip: ${(performance.now() - t).toFixed(0)} ms`)
t = performance.now(); structuredClone(catalog); console.log(`structuredClone: ${(performance.now() - t).toFixed(0)} ms`)
// equivalence: does toPublicInfo output equal a JSON round trip of the raw provider?
let diff = 0
for (const p of Object.values<any>(catalog)) if (JSON.stringify(toPublicInfo(p)) !== JSON.stringify(p)) diff++
console.log(`providers where toPublicInfo differs from plain JSON: ${diff}`)
