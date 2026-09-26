#!/usr/bin/env bun
// Packs the repo's video/ engine into src/video/template.txt so the RIFT binary can ship it.
import path from "path"
import { collect } from "../src/video/template"

const engine = path.resolve(import.meta.dir, "../../../../video")
const template = await collect(engine)
await Bun.write(path.resolve(import.meta.dir, "../src/video/template.txt"), JSON.stringify(template))
console.log(`packed ${Object.keys(template).length} files from ${engine}`)
