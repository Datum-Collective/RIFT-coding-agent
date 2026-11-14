export * as RiftStages from "./stages.js"

import path from "node:path"

/** The CI ladder in rank order. */
export const KINDS = ["install", "format", "lint", "typecheck", "build", "test", "e2e", "proof"] as const
export type Kind = (typeof KINDS)[number]

/** Why each kind of check runs, said to the user next to the check. */
const WHY: Readonly<Record<Kind, string>> = {
  install: "The other checks need the project's dependencies, so they are installed in a clean copy first.",
  format: "Formatting drift is cheap to catch and noisy in review.",
  lint: "Static rules catch misuse the compiler accepts, without running any code.",
  typecheck: "A type error is a bug found without running anything, and the agent's edit may have broken a caller.",
  build: "The project has to compile before its behaviour can be judged.",
  test: "The project's own tests say whether existing behaviour still holds on the agent's change.",
  e2e: "End-to-end tests catch breakage between parts that unit tests cover one at a time.",
  proof: "The agent claimed this in its engineering graph; this check is the evidence for the claim.",
}
export const why = (kind: string): string | undefined => WHY[kind as Kind]

/**
 * Which kinds gate a kind: in the stage's own unit, and for install at the unit's install root. A kind the plan
 * lacks is dropped, not failed. Static checks need only the install, so a lint failure never hides a test result.
 * This is the only place gating is written.
 */
const NEEDS: Readonly<Record<Kind, readonly Kind[]>> = {
  install: [],
  format: ["install"],
  lint: ["install"],
  typecheck: ["install"],
  build: ["install"],
  test: ["install", "build"],
  e2e: ["install", "build", "test"],
  proof: ["install", "build"],
}
/** Kinds whose failures may be flaky and are rerun before they count. Static checks are deterministic. */
const RERUN: ReadonlySet<Kind> = new Set(["test", "e2e", "proof"])
const TIMEOUT_MS = 10 * 60 * 1000
const DOCS = /\.(md|mdx|txt|rst)$/i
/** Directories whose manifests belong to someone else's code or to test data, never a unit of this project. */
const FOREIGN = /(^|\/)(node_modules|vendor|testdata|fixtures|__fixtures__)\//

/** Relative to the project root, "." for the root. */
export type UnitDir = string & { readonly UnitDir: unique symbol }
/** `${unit}:${kind}:${name}`, stable across runs, so a baseline and a cache can find the same stage. */
export type StageId = string & { readonly StageId: unique symbol }
export type EcosystemId = "make" | "node" | "go" | "rust" | "python"

export interface Declared {
  readonly kind: Kind
  readonly name: string
  readonly command: string
  /** Relative to the unit. Only graph checks set it. */
  readonly cwd?: string
  readonly ecosystem?: EcosystemId
  /** A graph check: its result is recorded as a proof of this node. */
  readonly proof?: { readonly node: string; readonly label: string }
}

export interface Unit {
  readonly dir: UnitDir
  readonly ecosystems: readonly EcosystemId[]
  readonly declared: readonly Declared[]
  /** The unit whose install provides this unit's dependencies: itself for a lockfile root, else the nearest one above. */
  readonly installRoot: UnitDir
  /** Kinds a workspace root runs for all its members (`turbo run test`, `cargo test --workspace`), so members skip them. */
  readonly covers: ReadonlySet<Kind>
  /** Said in the report, such as "dependencies resolved without a lockfile". */
  readonly notes: readonly string[]
}

/** A manifest no ecosystem runs. Named in the report, so "verified" never silently means "everything". */
export interface Uncovered {
  readonly path: string
  readonly why: string
}

export interface Detected {
  readonly units: readonly Unit[]
  readonly uncovered: readonly Uncovered[]
}

export interface Stage {
  readonly id: StageId
  readonly unit: UnitDir
  readonly kind: Kind
  readonly name: string
  readonly command: string
  /** Relative to the project root. */
  readonly cwd: string
  /** Derived from NEEDS by `plan`. Never written by hand. */
  readonly needs: readonly StageId[]
  readonly rerun: boolean
  readonly timeoutMs: number
  readonly ecosystem?: EcosystemId
  readonly proof?: Declared["proof"]
}

/** Stages in topological order: every stage comes after everything it needs. */
export interface Plan {
  readonly stages: readonly Stage[]
  readonly notes: readonly string[]
  readonly uncovered: readonly Uncovered[]
}

/** A git tree read without copying it, so detection is a pure function of content. */
export interface TreeReader {
  readonly files: readonly string[]
  /** Contents of the files detection reads (`READS`); undefined for any other file. */
  readonly read: (file: string) => string | undefined
  readonly size: (file: string) => number | undefined
}

interface Found {
  readonly declared: readonly Declared[]
  readonly covers?: readonly Kind[]
  readonly notes?: readonly string[]
}

interface Project {
  readonly has: (dir: string, name: string) => boolean
  readonly read: (dir: string, name: string) => string | undefined
  readonly size: (dir: string, name: string) => number | undefined
  /** The nearest directory from `dir` up to the root that has one of `names`, and which name it has. */
  readonly find: (dir: string, names: readonly string[]) => { readonly dir: string; readonly name: string } | undefined
}

export interface Ecosystem {
  readonly id: EcosystemId
  /** What detection looks for, said when it finds nothing. */
  readonly looks: string
  /** Files whose presence makes a directory a unit of this ecosystem. */
  readonly manifests: readonly string[]
  /** Files whose contents detection reads, so a tree reader loads only these. */
  readonly reads: readonly string[]
  readonly unit: (dir: string, project: Project) => Found | undefined
  /** Ignored directories the snapshot env links from the live tree in place of an install. */
  readonly links: readonly string[]
  /** Extra environment for every stage of this ecosystem, given a cache directory RIFT owns. */
  readonly env?: (cache: string) => Readonly<Record<string, string>>
}

export const join = (dir: string, name: string) => (dir === "." ? name : `${dir}/${name}`)
const parent = (dir: string) => (dir === "." ? undefined : path.posix.dirname(dir))
/** Whether a project path is `root` or lies under it. */
export const inside = (dir: string, root: string) => root === "." || dir === root || dir.startsWith(`${root}/`)
/** `dir` and every directory above it, up to ".". */
export const ancestors = (dir: string) => {
  const dirs: string[] = []
  for (let current: string | undefined = dir; current !== undefined; current = parent(current)) dirs.push(current)
  return dirs
}

type Names = readonly (readonly [Kind, readonly string[]])[]

/** Per kind, the Makefile targets a project uses for it, best first. `check` is GNU's name for the test suite. */
const TARGETS: Names = [
  ["format", ["fmt-check", "format-check", "check-format"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck"]],
  ["build", ["build"]],
  ["test", ["test", "check"]],
  ["e2e", ["e2e", "test-e2e"]],
]
/** Per kind, the package.json scripts a project uses for it, best first. */
const SCRIPTS: Names = [
  ["format", ["format:check", "fmt:check", "check:format"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck", "type-check", "check-types"]],
  ["build", ["build"]],
  ["test", ["test"]],
  ["e2e", ["test:e2e", "e2e"]],
]

const named = (table: Names, available: (name: string) => boolean, command: (name: string) => string, ecosystem: EcosystemId) =>
  table.flatMap(([kind, names]): Declared[] => {
    const name = names.find(available)
    return name ? [{ kind, name, command: command(name), ecosystem }] : []
  })

const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"]

const make: Ecosystem = {
  id: "make",
  looks: "Makefile targets",
  manifests: MAKEFILES,
  reads: MAKEFILES,
  links: [],
  unit: (dir, project) => {
    const file = MAKEFILES.find((name) => project.has(dir, name))
    if (!file) return undefined
    const targets = new Set([...(project.read(dir, file) ?? "").matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?!=)/gm)].map((m) => m[1]!))
    return { declared: named(TARGETS, (name) => targets.has(name), (name) => `make ${name}`, "make") }
  },
}

const LOCKS = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"] as const
const RUNNER: Record<(typeof LOCKS)[number], "bun" | "pnpm" | "yarn" | "npm"> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
}
const FROZEN: Record<"bun" | "pnpm" | "yarn" | "npm" | "yarn-berry", string> = {
  bun: "bun install --frozen-lockfile",
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --frozen-lockfile",
  "yarn-berry": "yarn install --immutable",
  npm: "npm ci",
}
const DEPENDENCIES = ["dependencies", "devDependencies", "optionalDependencies", "workspaces"]
/** A root script that runs every member's script of the same name. */
const FANOUT = /\b(turbo|nx|lerna|wireit)\b|(?:^|\s)(?:-r|--recursive|-ws|--workspaces|--filter)(?:\s|=|$)/
const placeholder = (script: string) => /no test specified/.test(script) || /(^|&&|;)\s*exit 1\s*$/.test(script)

const manifest = (text: string | undefined): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text ?? "")
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Which package manager runs a project that shows no lockfile. The lockfile may simply be out of view: the project
 * can be one package of a workspace whose lockfile sits in a folder above it. So the project's own words decide, in
 * the order of how plainly they say it: the `packageManager` field, a bunfig.toml, then the scripts. Only a project
 * that says nothing is npm's.
 */
const inferRunner = (pkg: Record<string, unknown>, scripts: Record<string, unknown>, bunfig: boolean): "bun" | "pnpm" | "yarn" | "npm" => {
  const declared = typeof pkg.packageManager === "string" ? /^(bun|pnpm|yarn|npm)@/.exec(pkg.packageManager)?.[1] : undefined
  if (declared) return declared as "bun" | "pnpm" | "yarn" | "npm"
  if (bunfig) return "bun"
  return Object.values(scripts).some((script) => typeof script === "string" && /(^|[\s;&|(])bunx?(\s|$)/.test(script)) ? "bun" : "npm"
}

/** Dependency specs only pnpm and Bun resolve; npm fails on them with EUNSUPPORTEDPROTOCOL. */
const PROTOCOL = /^(catalog|workspace):/
const protocolDependencies = (pkg: Record<string, unknown>) =>
  ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some((key) =>
    Object.values((pkg[key] ?? {}) as Record<string, unknown>).some((spec) => typeof spec === "string" && PROTOCOL.test(spec)),
  )

const node: Ecosystem = {
  id: "node",
  looks: "package.json scripts",
  manifests: ["package.json"],
  reads: ["package.json"],
  links: ["node_modules"],
  unit: (dir, project) => {
    if (!project.has(dir, "package.json")) return undefined
    const pkg = manifest(project.read(dir, "package.json"))
    if (!pkg) return { declared: [], notes: [`${join(dir, "package.json")} is not valid JSON`] }
    const lock = project.find(dir, LOCKS)
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>
    const runner = lock ? RUNNER[lock.name as (typeof LOCKS)[number]] : inferRunner(pkg, scripts, project.has(dir, "bunfig.toml"))
    const script = (name: string) => (typeof scripts[name] === "string" ? (scripts[name] as string) : undefined)
    const declared = named(
      SCRIPTS,
      (name) => script(name) !== undefined && !placeholder(script(name)!),
      (name) => `${runner} run ${name}`,
      "node",
    )
    const workspace = pkg.workspaces !== undefined || project.has(dir, "pnpm-workspace.yaml")
    const covers = workspace ? declared.filter((item) => FANOUT.test(script(item.name)!)).map((item) => item.kind) : []
    const notes: string[] = []
    const top = lock ? lock.dir === dir : !ancestors(dir).slice(1).some((above) => project.has(above, "package.json"))
    // A project with no dependencies has nothing to install, and an empty lockfile is no lockfile.
    if (top && DEPENDENCIES.some((key) => pkg[key] !== undefined)) {
      const locked = lock && (project.size(lock.dir, lock.name) ?? 0) > 0
      const berry = typeof pkg.packageManager === "string" && /^yarn@[2-9]/.test(pkg.packageManager)
      const install = !locked
        ? `${runner} install`
        : runner === "yarn" && (berry || project.has(dir, ".yarnrc.yml"))
          ? FROZEN["yarn-berry"]
          : FROZEN[runner]
      if (!locked && runner === "npm" && protocolDependencies(pkg)) {
        // Nothing is installed, so the checks that follow fail or are not run, in the open. Installing with npm
        // would only fail on a spec it cannot read, and say nothing true about the code.
        notes.push(`${dir}: dependencies use catalog: or workspace: specs, which npm cannot install, and no lockfile shows which tool can`)
      } else {
        if (!locked) notes.push(`${dir}: dependencies resolved without a lockfile`)
        declared.unshift({ kind: "install", name: "install", command: install, ecosystem: "node" })
      }
    }
    return { declared, covers, notes }
  },
}

const go: Ecosystem = {
  id: "go",
  looks: "go.mod",
  manifests: ["go.mod"],
  reads: [],
  links: [],
  unit: (dir, project) =>
    project.has(dir, "go.mod")
      ? {
          declared: [
            { kind: "install", name: "install", command: "go mod download && go mod verify", ecosystem: "go" },
            { kind: "format", name: "gofmt", command: 'test -z "$(gofmt -l . | tee /dev/stderr)"', ecosystem: "go" },
            { kind: "lint", name: "vet", command: "go vet ./...", ecosystem: "go" },
            { kind: "build", name: "build", command: "go build ./...", ecosystem: "go" },
            { kind: "test", name: "test", command: "go test ./...", ecosystem: "go" },
          ],
        }
      : undefined,
}

const rust: Ecosystem = {
  id: "rust",
  looks: "Cargo.toml",
  manifests: ["Cargo.toml"],
  reads: ["Cargo.toml"],
  links: [],
  // Builds reuse a target directory RIFT owns, so the user's `target/` is never written and a turn is not a cold build.
  env: (cache) => ({ CARGO_TARGET_DIR: path.join(cache, "target") }),
  unit: (dir, project) => {
    if (!project.has(dir, "Cargo.toml")) return undefined
    const workspace = /^\s*\[workspace\]/m.test(project.read(dir, "Cargo.toml") ?? "")
    const lock = project.find(dir, ["Cargo.lock"])
    const locked = lock ? " --locked" : ""
    const all = workspace ? " --workspace" : ""
    const declared: Declared[] = [
      { kind: "format", name: "fmt", command: `cargo fmt${workspace ? " --all" : ""} --check`, ecosystem: "rust" },
      { kind: "lint", name: "clippy", command: `cargo clippy${all}${locked}`, ecosystem: "rust" },
      { kind: "build", name: "build", command: `cargo build${all}${locked}`, ecosystem: "rust" },
      { kind: "test", name: "test", command: `cargo test${all}${locked}`, ecosystem: "rust" },
    ]
    const notes: string[] = []
    const member = ancestors(dir)
      .slice(1)
      .some((above) => /^\s*\[workspace\]/m.test(project.read(above, "Cargo.toml") ?? ""))
    if (lock?.dir === dir || (!lock && !member)) {
      declared.unshift({ kind: "install", name: "fetch", command: `cargo fetch${locked}`, ecosystem: "rust" })
      if (!lock) notes.push(`${dir}: dependencies resolved without a lockfile`)
    }
    return { declared, covers: workspace ? ["format", "lint", "build", "test"] : [], notes }
  },
}

const python: Ecosystem = {
  id: "python",
  looks: "pyproject.toml with uv.lock or poetry.lock",
  manifests: ["pyproject.toml"],
  reads: ["pyproject.toml"],
  links: [".venv"],
  unit: (dir, project) => {
    if (!project.has(dir, "pyproject.toml")) return undefined
    const lock = project.find(dir, ["uv.lock", "poetry.lock"])
    if (!lock) return undefined
    const config = project.read(dir, "pyproject.toml") ?? ""
    // `--no-sync`: a stage uses the environment the install made, and never changes a linked one.
    const run = lock.name === "uv.lock" ? "uv run --no-sync" : "poetry run"
    const declared: Declared[] = []
    if (lock.dir === dir)
      declared.push({
        kind: "install",
        name: "sync",
        command: lock.name === "uv.lock" ? "uv sync --locked" : "poetry install --sync",
        ecosystem: "python",
      })
    if (/^\s*\[tool\.ruff/m.test(config) || project.has(dir, "ruff.toml") || project.has(dir, ".ruff.toml"))
      declared.push(
        { kind: "format", name: "ruff-format", command: `${run} ruff format --check`, ecosystem: "python" },
        { kind: "lint", name: "ruff", command: `${run} ruff check`, ecosystem: "python" },
      )
    if (/^\s*\[tool\.mypy/m.test(config) || project.has(dir, "mypy.ini"))
      declared.push({ kind: "typecheck", name: "mypy", command: `${run} mypy .`, ecosystem: "python" })
    else if (/^\s*\[tool\.pyright/m.test(config) || project.has(dir, "pyrightconfig.json"))
      declared.push({ kind: "typecheck", name: "pyright", command: `${run} pyright`, ecosystem: "python" })
    if (/\bpytest\b/.test(config) || project.has(dir, "pytest.ini") || project.has(dir, "conftest.py"))
      declared.push({ kind: "test", name: "pytest", command: `${run} pytest`, ecosystem: "python" })
    return { declared }
  },
}

/**
 * The one list of ecosystems. For the same directory and kind, an earlier entry wins: a target the project
 * declares in its Makefile beats a package.json script, and a script beats a toolchain convention.
 */
export const ECOSYSTEMS: readonly Ecosystem[] = [make, node, go, rust, python]

/** Manifests of build systems RIFT does not run. One is reported when no unit covers its directory. */
const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/(^|\/)(pyproject\.toml|requirements[^/]*\.txt|setup\.py)$/, "python without uv.lock or poetry.lock"],
  [/(^|\/)pom\.xml$/, "maven is not supported"],
  [/(^|\/)build\.gradle(\.kts)?$/, "gradle is not supported"],
  [/(^|\/)Gemfile$/, "ruby is not supported"],
  [/(^|\/)composer\.json$/, "php is not supported"],
  [/(^|\/)Package\.swift$/, "swift is not supported"],
  [/(^|\/)mix\.exs$/, "elixir is not supported"],
  [/\.(csproj|fsproj|sln)$/, ".NET is not supported"],
]

/** What detection looked for, for the report when it finds nothing. */
export const LOOKED = ECOSYSTEMS.map((ecosystem) => ecosystem.looks)
/** Every file name whose contents detection reads. */
export const READS: ReadonlySet<string> = new Set(ECOSYSTEMS.flatMap((ecosystem) => ecosystem.reads))
export const ecosystem = (id: EcosystemId) => ECOSYSTEMS.find((item) => item.id === id)!

export const detect = (tree: TreeReader): Detected => {
  const files = new Set(tree.files)
  const project: Project = {
    has: (dir, name) => files.has(join(dir, name)),
    read: (dir, name) => tree.read(join(dir, name)),
    size: (dir, name) => tree.size(join(dir, name)),
    find: (dir, names) => {
      for (const above of ancestors(dir)) {
        const name = names.find((item) => files.has(join(above, item)))
        if (name) return { dir: above, name }
      }
      return undefined
    },
  }
  const manifests = new Set(ECOSYSTEMS.flatMap((item) => item.manifests))
  const dirs = [
    ...new Set(
      tree.files
        .filter((file) => manifests.has(path.posix.basename(file)) && !FOREIGN.test(file))
        .map((file) => path.posix.dirname(file)),
    ),
  ].sort()

  const merged = dirs.flatMap((dir) => {
    const found = ECOSYSTEMS.flatMap((item) => {
      const unit = item.unit(dir, project)
      return unit ? [{ id: item.id, unit }] : []
    })
    if (found.length === 0) return []
    const kinds = new Set<Kind>()
    const declared = found.flatMap(({ unit }) =>
      unit.declared.filter((item) => {
        if (kinds.has(item.kind)) return false
        kinds.add(item.kind)
        return true
      }),
    )
    return [
      {
        dir: dir as UnitDir,
        ecosystems: found.map((item) => item.id),
        declared,
        covers: new Set(found.flatMap(({ unit }) => unit.covers ?? [])),
        notes: found.flatMap(({ unit }) => unit.notes ?? []),
      },
    ]
  })
  const installs = (unit: (typeof merged)[number]) => unit.declared.some((item) => item.kind === "install")
  const units: Unit[] = merged.map((unit) => {
    const root = ancestors(unit.dir).find((above) => {
      const candidate = merged.find((item) => item.dir === above)
      return candidate && installs(candidate) && candidate.ecosystems.some((id) => unit.ecosystems.includes(id))
    })
    return { ...unit, installRoot: (root ?? unit.dir) as UnitDir }
  })
  const covered = new Set<string>(units.map((unit) => unit.dir))
  const uncovered = tree.files.flatMap((file) => {
    if (FOREIGN.test(file) || covered.has(path.posix.dirname(file))) return []
    const match = UNSUPPORTED.find(([pattern]) => pattern.test(file))
    return match ? [{ path: file, why: match[1] }] : []
  })
  return { units, uncovered }
}

export type Scope =
  | { readonly kind: "all" }
  /** `/verify packages/web`: units under these paths, and the unit that contains each. */
  | { readonly kind: "paths"; readonly paths: readonly string[] }
  /** The change tier: per edited file, the nearest unit that has a stage of the tier's kinds. */
  | { readonly kind: "files"; readonly files: readonly string[] }

interface Draft extends Omit<Stage, "needs"> {
  readonly installRoot: UnitDir
}

/** Selects units by scope, keeps the tier's kinds, adds graph checks as proof stages, derives `needs`, sorts. */
export const plan = (detected: Detected, kinds: ReadonlySet<Kind>, scope: Scope, graph: readonly Declared[]): Plan => {
  const { units } = detected
  /** The nearest unit above `unit` that runs `kind` for all its members. */
  const coverer = (unit: Unit, kind: Kind) =>
    ancestors(unit.dir)
      .slice(1)
      .map((above) => units.find((other) => other.dir === above))
      .find((other) => other?.covers.has(kind))
  const own = (unit: Unit) =>
    unit.declared.filter((item) => item.kind !== "install" && kinds.has(item.kind) && !coverer(unit, item.kind))
  const nearest = (dir: string) =>
    ancestors(dir)
      .map((above) => units.find((unit) => unit.dir === above))
      .find((unit) => unit !== undefined && own(unit).length > 0)
  const selected = new Set<Unit>(
    scope.kind === "all"
      ? units
      : scope.kind === "paths"
        ? scope.paths.flatMap((target) => [
            ...units.filter((unit) => inside(unit.dir, target)),
            ...(nearest(target) ? [nearest(target)!] : []),
          ])
        : scope.files.flatMap((file) => (nearest(path.posix.dirname(file)) ? [nearest(path.posix.dirname(file))!] : [])),
  )

  const draft = (unit: Pick<Unit, "dir" | "installRoot">, declared: Declared): Draft => ({
    id: `${unit.dir}:${declared.kind}:${declared.name}` as StageId,
    unit: unit.dir,
    installRoot: unit.installRoot,
    kind: declared.kind,
    name: declared.name,
    command: declared.command,
    cwd: path.posix.normalize(join(unit.dir, declared.cwd ?? ".")),
    rerun: RERUN.has(declared.kind),
    timeoutMs: TIMEOUT_MS,
    ecosystem: declared.ecosystem,
    proof: declared.proof,
  })
  const drafts = [...selected].flatMap((unit) => [
    ...own(unit).map((item) => draft(unit, item)),
    // A kind a workspace root covers for this unit is checked by the root's stage.
    ...unit.declared.flatMap((item) => {
      const above = item.kind === "install" || !kinds.has(item.kind) ? undefined : coverer(unit, item.kind)
      return above ? above.declared.filter((other) => other.kind === item.kind).map((other) => draft(above, other)) : []
    }),
  ])
  const root = units.find((unit) => unit.dir === ".") ?? { dir: "." as UnitDir, installRoot: "." as UnitDir }
  if (scope.kind !== "paths") drafts.push(...graph.filter((item) => kinds.has(item.kind)).map((item) => draft(root, item)))
  if (kinds.has("install")) {
    const roots = new Set(drafts.map((item) => item.installRoot))
    for (const unit of units.filter((item) => roots.has(item.dir)))
      drafts.push(...unit.declared.filter((item) => item.kind === "install").map((item) => draft(unit, item)))
  }

  const seen = new Map<string, number>()
  const distinct = [...new Map(drafts.map((item) => [`${item.id}\0${item.command}\0${item.cwd}`, item])).values()]
  const unique = distinct.map((item) => {
    const count = seen.get(item.id) ?? 0
    seen.set(item.id, count + 1)
    return count === 0 ? item : { ...item, id: `${item.id}#${count + 1}` as StageId }
  })
  const rank = (kind: Kind) => KINDS.indexOf(kind)
  unique.sort((a, b) => rank(a.kind) - rank(b.kind) || a.unit.localeCompare(b.unit) || a.id.localeCompare(b.id))
  const stages = unique.map(({ installRoot, ...stage }): Stage => ({
    ...stage,
    needs: NEEDS[stage.kind].flatMap((kind) =>
      unique
        .filter((other) => other.kind === kind && other.unit === (kind === "install" ? installRoot : stage.unit))
        .map((other) => other.id),
    ),
  }))
  const unitsInPlan = new Set(stages.map((stage) => stage.unit))
  return {
    stages,
    notes: units.filter((unit) => unitsInPlan.has(unit.dir)).flatMap((unit) => unit.notes),
    uncovered:
      scope.kind === "all"
        ? detected.uncovered
        : scope.kind === "paths"
          ? detected.uncovered.filter((item) => scope.paths.some((target) => inside(item.path, target)))
          : [],
  }
}

/** `ids` and everything they need, transitively, in plan order. The baseline runs exactly this. */
export const closure = (plan: Plan, ids: readonly StageId[]): Plan => {
  const byId = new Map(plan.stages.map((stage) => [stage.id, stage]))
  const wanted = new Set<StageId>()
  const visit = (id: StageId) => {
    if (wanted.has(id)) return
    wanted.add(id)
    byId.get(id)?.needs.forEach(visit)
  }
  ids.forEach(visit)
  return { ...plan, stages: plan.stages.filter((stage) => wanted.has(stage.id)) }
}

export const docsOnly = (files: readonly string[]) => files.length > 0 && files.every((file) => DOCS.test(file))
