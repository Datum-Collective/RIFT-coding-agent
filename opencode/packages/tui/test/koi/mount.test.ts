import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// The black hole is a component, and a component nothing mounts draws nothing. Merge 83323a7a removed the
// one line that mounts it from the home route while every test of the component itself kept passing.
test("the home route mounts the black hole", () => {
  const source = readFileSync(path.join(import.meta.dir, "../../src/routes/home.tsx"), "utf8")
  expect(source).toMatch(/import \{ IdleSingularity \} from "..\/component\/idle-singularity"/)
  expect(source).toMatch(/<IdleSingularity\s*\/>/)
})
