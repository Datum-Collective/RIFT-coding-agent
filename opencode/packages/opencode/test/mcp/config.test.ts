import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { McpConfig } from "../../src/mcp/config"
import { McpSearch } from "../../src/mcp/search"
import { McpCatalog } from "../../src/mcp/catalog"
import { Permission } from "../../src/permission"

describe("McpConfig.expand", () => {
  test("expands ${VAR} and ${VAR:-default}, reports missing", () => {
    const missing = new Set<string>()
    expect(McpConfig.expand("a ${X} ${Y:-dflt} ${Z}", { X: "1" }, missing)).toBe("a 1 dflt ")
    expect([...missing]).toEqual(["Z"])
  })
  test("an empty variable takes the default", () => {
    expect(McpConfig.expand("${X:-d}", { X: "" })).toBe("d")
  })
  test("null env keeps the text as written", () => {
    expect(McpConfig.expand("${X:-d}", null)).toBe("${X:-d}")
  })
})

describe("McpConfig.fromJson / toJson", () => {
  test("stdio is the default when command is set", () => {
    expect(McpConfig.fromJson("a", { command: "npx", args: ["-y", "${PKG}"], env: { K: "${K:-v}" } }, { PKG: "p" })).toEqual({
      type: "local",
      command: ["npx", "-y", "p"],
      environment: { K: "v" },
    })
  })
  test("http and sse map to remote", () => {
    expect(McpConfig.fromJson("a", { type: "sse", url: "https://x/${P}", headers: { A: "${T}" } }, { P: "mcp", T: "t" })).toEqual({
      type: "remote",
      url: "https://x/mcp",
      headers: { A: "t" },
    })
  })
  test("disabled maps to enabled: false and back", () => {
    const config = McpConfig.fromJson("a", { url: "https://x", disabled: true }, {})
    expect(config).toEqual({ type: "remote", url: "https://x", enabled: false })
    expect(McpConfig.toJson(config)).toEqual({ type: "http", url: "https://x", disabled: true })
  })
  test("an entry with neither command nor url is rejected", () => {
    expect(() => McpConfig.fromJson("a", {}, {})).toThrow("needs a command")
  })
})

describe("McpConfig.load", () => {
  let root: string
  let prevHome: string | undefined
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rift-mcp-config-"))
    prevHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = path.join(root, "home")
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENCODE_TEST_HOME
    else process.env.OPENCODE_TEST_HOME = prevHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("user < project < local, nearest .mcp.json wins, untyped enabled:false turns a server off", () => {
    const project = path.join(root, "repo")
    const sub = path.join(project, "pkg")
    fs.mkdirSync(sub, { recursive: true })
    McpConfig.writeServersFile(McpConfig.USER_FILE(), (s) => {
      s.shared = { command: "user-cmd" }
      s.useronly = { command: "u" }
      s.off = { command: "o" }
    })
    McpConfig.writeServersFile(path.join(project, ".mcp.json"), (s) => {
      s.shared = { command: "root-cmd" }
      s.rootonly = { command: "r" }
    })
    McpConfig.writeServersFile(path.join(sub, ".mcp.json"), (s) => {
      s.rootonly = { command: "nearest" }
    })
    const entries = McpConfig.load({
      directory: sub,
      worktree: project,
      env: {},
      local: { shared: { type: "local", command: ["local-cmd"] }, off: { enabled: false } },
    })
    expect(entries.shared).toEqual({ config: { type: "local", command: ["local-cmd"] }, scope: "local" })
    expect(entries.useronly.scope).toBe("user")
    expect(entries.rootonly.scope).toBe("project")
    expect(entries.rootonly.config).toEqual({ type: "local", command: ["nearest"] })
    expect(entries.off.config.enabled).toBe(false)
  })

  test("approvals and disables are remembered per project", () => {
    const a = path.join(root, "a")
    const b = path.join(root, "b")
    process.env.XDG_STATE_HOME ??= path.join(root, "state")
    McpConfig.remember(a, "srv", "allow")
    McpConfig.remember(b, "srv", "deny")
    expect(McpConfig.decision(a, "srv")).toBe("allow")
    expect(McpConfig.decision(b, "srv")).toBe("deny")
    McpConfig.remember(a, "srv", undefined)
    expect(McpConfig.decision(a, "srv")).toBeUndefined()
    McpConfig.setDisabled(a, "x", true)
    expect(McpConfig.disabled(a).has("x")).toBe(true)
    McpConfig.setDisabled(a, "x", false)
    expect(McpConfig.disabled(a).has("x")).toBe(false)
    McpConfig.remember(b, "srv", undefined)
  })
})

describe("McpSearch", () => {
  const def = (name: string, description: string) => ({ name, description, inputSchema: { type: "object" as const, properties: {} } })
  const candidates = [
    { name: "mcp__gh__create_issue", def: def("create_issue", "Create a GitHub issue") },
    { name: "mcp__gh__list_issue", def: def("list_issue", "List issues") },
    { name: "mcp__db__query", def: def("query", "Run SQL against the database") },
  ]

  test("select: picks exact names", () => {
    expect(McpSearch.find("select:mcp__db__query,mcp__gh__list_issue", candidates).map((c) => c.name)).toEqual([
      "mcp__gh__list_issue",
      "mcp__db__query",
    ])
  })
  test("keywords rank name hits above description hits", () => {
    expect(McpSearch.find("create issue", candidates)[0].name).toBe("mcp__gh__create_issue")
    expect(McpSearch.find("sql", candidates).map((c) => c.name)).toEqual(["mcp__db__query"])
    expect(McpSearch.find("nothing-here", candidates)).toEqual([])
  })
  test("mode and threshold", () => {
    expect(McpSearch.mode({ RIFT_MCP_TOOL_SEARCH: "off" })).toBe("never")
    expect(McpSearch.mode({ OPENCODE_MCP_TOOL_SEARCH: "always" })).toBe("always")
    expect(McpSearch.mode({})).toBe("auto")
    expect(McpSearch.shouldDefer([def("a", "b")], "auto")).toBe(false)
    expect(McpSearch.shouldDefer([def("a", "b")], "always")).toBe(true)
    const many = Array.from({ length: 200 }, (_, i) => def(`t${i}`, "x".repeat(40)))
    expect(McpSearch.shouldDefer(many, "auto")).toBe(true)
    expect(McpSearch.shouldDefer(many, "never")).toBe(false)
  })
  test("description lists names grouped by server", () => {
    const text = McpSearch.description(["mcp__gh__a", "mcp__gh__b", "mcp__db__q"], ["slow"])
    expect(text).toContain("- db: q")
    expect(text).toContain("- gh: a, b")
    expect(text).toContain("Still connecting (searching waits for them): slow.")
  })
  test("tool names are mcp__server__tool", () => {
    expect(McpCatalog.toolName("my server", "do.it")).toBe("mcp__my_server__do_it")
    expect(McpCatalog.serverOf("mcp__my_server__do_it")).toBe("my_server")
    expect(McpCatalog.serverOf("bash")).toBeUndefined()
  })
})

describe("MCP permission rules", () => {
  test("mcp__server__* denies a whole server, mcp__server__tool one tool", () => {
    const tools = ["mcp__gh__create_issue", "mcp__gh__list_issue", "mcp__db__query", "mcp__db__drop"]
    const denied = Permission.disabled(tools, [
      { permission: "mcp__gh__*", pattern: "*", action: "deny" },
      { permission: "mcp__db__drop", pattern: "*", action: "deny" },
    ])
    expect([...denied].sort()).toEqual(["mcp__db__drop", "mcp__gh__create_issue", "mcp__gh__list_issue"])
  })
})
