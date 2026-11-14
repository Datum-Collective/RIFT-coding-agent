import { describe, expect, test } from "bun:test"
import { RiftStages } from "../../src/plugin/rift-verify/stages.js"

const tree = (files: Record<string, string>): RiftStages.TreeReader => ({
  files: Object.keys(files),
  read: (file) => files[file],
  size: (file) => files[file]?.length,
})
const json = (value: unknown) => JSON.stringify(value)
const ALL = new Set(RiftStages.KINDS)
const CHANGE = new Set<RiftStages.Kind>(["format", "lint", "typecheck", "test", "proof"])
const plan = (files: Record<string, string>, scope: RiftStages.Scope = { kind: "all" }, kinds = ALL, graph: RiftStages.Declared[] = []) =>
  RiftStages.plan(RiftStages.detect(tree(files)), kinds, scope, graph)
const commands = (result: RiftStages.Plan) => result.stages.map((stage) => stage.command)
const stage = (result: RiftStages.Plan, command: string) => result.stages.find((item) => item.command === command)!
const needs = (result: RiftStages.Plan, command: string) =>
  stage(result, command).needs.map((id) => result.stages.find((item) => item.id === id)!.command)

describe("RiftStages detection", () => {
  test("runs the project's own scripts with its lockfile's runner, and ignores the npm placeholder", () => {
    const result = plan({
      "bun.lock": "",
      "package.json": json({ scripts: { typecheck: "tsc", test: 'echo "Error: no test specified" && exit 1' } }),
    })
    expect(commands(result)).toEqual(["bun run typecheck"])
  })

  test("installs from the lockfile, frozen, and only when there is something to install", () => {
    const deps = { dependencies: { a: "1" }, scripts: { test: "t" } }
    expect(commands(plan({ "package.json": json(deps), "bun.lock": "{}" }))[0]).toBe("bun install --frozen-lockfile")
    expect(commands(plan({ "package.json": json(deps), "package-lock.json": "{}" }))[0]).toBe("npm ci")
    expect(commands(plan({ "package.json": json(deps), "pnpm-lock.yaml": "x" }))[0]).toBe("pnpm install --frozen-lockfile")
    expect(commands(plan({ "package.json": json(deps), "yarn.lock": "x" }))[0]).toBe("yarn install --frozen-lockfile")
    expect(commands(plan({ "package.json": json(deps), "yarn.lock": "x", ".yarnrc.yml": "" }))[0]).toBe("yarn install --immutable")
    expect(commands(plan({ "package.json": json({ scripts: { test: "t" } }), "bun.lock": "{}" }))).toEqual(["bun run test"])
  })

  test("a missing or empty lockfile still installs, and says so", () => {
    const deps = json({ devDependencies: { a: "1" }, scripts: { test: "t" } })
    const none = plan({ "package.json": deps })
    expect(commands(none)[0]).toBe("npm install")
    expect(none.notes.join()).toContain("without a lockfile")
    const empty = plan({ "package.json": deps, "bun.lock": "" })
    expect(commands(empty)[0]).toBe("bun install")
    expect(empty.notes.join()).toContain("without a lockfile")
  })

  test("a Makefile target beats a package.json script for the same kind, and both still contribute", () => {
    const result = plan({
      Makefile: "test:\n\tbun test\n.PHONY: test\nVERSION := 1\n",
      "package.json": json({ scripts: { test: "jest", lint: "eslint ." } }),
    })
    expect(commands(result)).toEqual(["npm run lint", "make test"])
  })

  test("toolchains are run by their own conventions", () => {
    expect(commands(plan({ "go.mod": "module x" }))).toEqual([
      "go mod download && go mod verify",
      'test -z "$(gofmt -l . | tee /dev/stderr)"',
      "go vet ./...",
      "go build ./...",
      "go test ./...",
    ])
    expect(commands(plan({ "Cargo.toml": "[package]", "Cargo.lock": "" }))).toEqual([
      "cargo fetch --locked",
      "cargo fmt --check",
      "cargo clippy --locked",
      "cargo build --locked",
      "cargo test --locked",
    ])
    const uv = plan({ "pyproject.toml": "[tool.ruff]\n[dependency-groups]\ndev = ['pytest']", "uv.lock": "" })
    expect(commands(uv)).toEqual(["uv sync --locked", "uv run --no-sync ruff format --check", "uv run --no-sync ruff check", "uv run --no-sync pytest"])
  })

  test("a manifest nothing runs is named as not covered, and a covered one is not", () => {
    const result = plan({
      "package.json": json({ scripts: { test: "t" } }),
      "tools/requirements.txt": "x",
      "java/pom.xml": "x",
      "api/pyproject.toml": "[tool.pytest.ini_options]",
      "api/uv.lock": "",
      "api/requirements.txt": "x",
      "node_modules/x/pom.xml": "x",
    })
    expect(result.uncovered).toEqual([
      { path: "tools/requirements.txt", why: "python without uv.lock or poetry.lock" },
      { path: "java/pom.xml", why: "maven is not supported" },
    ])
    expect(commands(result)).toContain("uv run --no-sync pytest")
  })

  test("nothing in node_modules or test fixtures is a unit", () => {
    const result = plan({
      "package.json": json({ scripts: { test: "root" } }),
      "node_modules/dep/package.json": json({ scripts: { test: "dep" } }),
      "test/fixtures/app/package.json": json({ scripts: { test: "fixture" } }),
    })
    expect(result.stages.map((item) => `${item.unit}`)).toEqual(["."])
  })
})

describe("RiftStages.plan", () => {
  const ladder = {
    "bun.lock": "{}",
    "package.json": json({
      dependencies: { a: "1" },
      scripts: { lint: "l", build: "b", test: "t", "test:e2e": "e" },
    }),
  }

  test("a stage waits for what gates it: tests on the build, static checks only on the install", () => {
    const result = plan(ladder)
    expect(commands(result)).toEqual(["bun install --frozen-lockfile", "bun run lint", "bun run build", "bun run test", "bun run test:e2e"])
    expect(needs(result, "bun run lint")).toEqual(["bun install --frozen-lockfile"])
    expect(needs(result, "bun run test")).toEqual(["bun install --frozen-lockfile", "bun run build"])
    expect(needs(result, "bun run test:e2e")).toEqual(["bun install --frozen-lockfile", "bun run build", "bun run test"])
    expect(stage(result, "bun run test").rerun).toBe(true)
    expect(stage(result, "bun run lint").rerun).toBe(false)
  })

  test("a kind the tier leaves out is dropped from the gates, not failed", () => {
    const result = plan(ladder, { kind: "files", files: ["src/a.ts"] }, CHANGE)
    expect(commands(result)).toEqual(["bun run lint", "bun run test"])
    expect(needs(result, "bun run test")).toEqual([])
  })

  test("an edited file is checked by the nearest unit that has checks", () => {
    const files = {
      "package.json": json({ scripts: { test: "root" } }),
      "pkg/package.json": json({ scripts: { test: "pkg" } }),
      "docs/package.json": json({ name: "no checks" }),
    }
    const units = (edited: string[]) => plan(files, { kind: "files", files: edited }, CHANGE).stages.map((item) => `${item.unit}`)
    expect(units(["pkg/src/a.ts"])).toEqual(["pkg"])
    expect(units(["docs/a.ts"])).toEqual(["."])
    expect(units(["a.ts", "pkg/b.ts"])).toEqual([".", "pkg"])
  })

  test("members install at their workspace root, and a root that fans out covers its members", () => {
    const files = {
      "bun.lock": "{}",
      "package.json": json({ workspaces: ["packages/*"], scripts: { test: "turbo run test", lint: "biome check" } }),
      "packages/a/package.json": json({ scripts: { test: "bun test", lint: "eslint", build: "tsc" } }),
    }
    const result = plan(files)
    expect(result.stages.map((item) => `${item.unit} ${item.command}`)).toEqual([
      ". bun install --frozen-lockfile",
      ". bun run lint",
      "packages/a bun run lint",
      "packages/a bun run build",
      ". bun run test",
    ])
    expect(needs(result, "bun run build")).toEqual(["bun install --frozen-lockfile"])
    const edited = plan(files, { kind: "files", files: ["packages/a/src/x.ts"] }, CHANGE)
    expect(edited.stages.map((item) => `${item.unit} ${item.command}`)).toEqual(["packages/a bun run lint", ". bun run test"])
  })

  test("a path picks the units under it and the one that contains it, with their install", () => {
    const files = {
      "bun.lock": "{}",
      "package.json": json({ workspaces: ["packages/*"], scripts: { test: "root" } }),
      "packages/a/package.json": json({ scripts: { test: "a" } }),
      "packages/b/package.json": json({ scripts: { test: "b" } }),
    }
    const under = plan(files, { kind: "paths", paths: ["packages/a"] })
    expect(under.stages.map((item) => `${item.unit} ${item.kind}`)).toEqual([". install", "packages/a test"])
    const inside = plan(files, { kind: "paths", paths: ["packages/b/src/x.ts"] })
    expect(inside.stages.map((item) => `${item.unit} ${item.kind}`)).toEqual([". install", "packages/b test"])
  })

  test("graph checks become proof stages that wait for the root's install and build", () => {
    const check: RiftStages.Declared = { kind: "proof", name: "auth/logs in", command: "./e2e.sh", cwd: "app", proof: { node: "auth", label: "logs in" } }
    const result = plan(ladder, { kind: "all" }, ALL, [check])
    const proof = stage(result, "./e2e.sh")
    expect([proof.kind, proof.cwd, proof.proof?.node]).toEqual(["proof", "app", "auth"])
    expect(needs(result, "./e2e.sh")).toEqual(["bun install --frozen-lockfile", "bun run build"])
    expect(result.stages.at(-1)?.command).toBe("./e2e.sh")
  })

  test("the closure of a stage is it and everything it needs, in plan order", () => {
    const result = plan(ladder)
    const test = stage(result, "bun run test")
    expect(commands(RiftStages.closure(result, [test.id]))).toEqual(["bun install --frozen-lockfile", "bun run build", "bun run test"])
  })

  test("stage ids are stable across runs", () => {
    expect(plan(ladder).stages.map((item) => item.id)).toEqual(plan(ladder).stages.map((item) => item.id))
    expect(stage(plan(ladder), "bun run test").id).toBe(".:test:test" as RiftStages.StageId)
  })
})

test("docs-only edits are recognised", () => {
  expect(RiftStages.docsOnly(["a.md", "b.txt"])).toBe(true)
  expect(RiftStages.docsOnly(["a.md", "b.ts"])).toBe(false)
  expect(RiftStages.docsOnly([])).toBe(false)
})

describe("RiftStages when no lockfile is in view", () => {
  // The user opened RIFT in a package of a Bun workspace: its bun.lock is a folder above, outside the project.
  const member = {
    name: "cli",
    dependencies: { effect: "catalog:", "@scope/schema": "workspace:*" },
    scripts: { typecheck: "bun check --no-script -b", test: "bun test" },
  }

  test("a Bun package is run with bun, never with npm", () => {
    expect(commands(plan({ "package.json": json(member) })).some((command) => command.startsWith("npm"))).toBe(false)
    expect(commands(plan({ "package.json": json(member) }))).toContain("bun run test")
  })

  test("the packageManager field decides, and wins over what the scripts mention", () => {
    const pnpm = { dependencies: { a: "1" }, packageManager: "pnpm@9.0.0", scripts: { test: "bun test" } }
    expect(commands(plan({ "package.json": json(pnpm) }))).toContain("pnpm run test")
  })

  test("a bunfig.toml says Bun even when the scripts do not", () => {
    expect(commands(plan({ "package.json": json({ scripts: { test: "vitest" } }), "bunfig.toml": "" }))).toEqual(["bun run test"])
  })

  test("an npm project stays npm", () => {
    expect(commands(plan({ "package.json": json({ scripts: { test: "jest" } }) }))).toEqual(["npm run test"])
  })

  test("dependencies npm cannot install are not installed with npm, and the report says why", () => {
    const protocols = { dependencies: { effect: "catalog:" }, scripts: { test: "jest" } }
    const result = plan({ "package.json": json(protocols) })
    expect(commands(result).some((command) => command.startsWith("npm install"))).toBe(false)
    expect(RiftStages.detect(tree({ "package.json": json(protocols) })).units[0]!.notes.join(" ")).toContain("catalog:")
  })
})
