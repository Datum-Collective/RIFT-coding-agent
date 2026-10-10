// The command table. Each entry carries only what `rift --help` needs (name, aliases,
// description) plus a loader, so starting the CLI never imports a command it was not asked to run.
// test/cli/commands.test.ts checks every entry against the real command module.
import type { CommandModule } from "yargs"

type Loader = () => Promise<CommandModule<any, any> | { command?: unknown; describe?: unknown; aliases?: unknown }>

export type CommandEntry = {
  /** Name used to select the command from argv. The default command has none. */
  name?: string
  aliases?: string[]
  /** yargs command string, exactly as the command module declares it. */
  command: string
  describe: string
  load: Loader
}

// Order is the order of `rift --help`.
export const commands: CommandEntry[] = [
  {
    name: "mcp",
    command: "mcp",
    describe: "manage MCP (Model Context Protocol) servers",
    load: () => import("./cmd/mcp").then((m) => m.McpCommand),
  },
  {
    command: "$0 [project]",
    describe: "start opencode tui",
    load: () => import("./cmd/tui").then((m) => m.TuiThreadCommand),
  },
  {
    name: "run",
    command: "run [message..]",
    describe: "run opencode with a message",
    load: () => import("./cmd/run").then((m) => m.RunCommand),
  },
  {
    name: "debug",
    command: "debug",
    describe: "version and path information",
    load: () => import("./cmd/debug").then((m) => m.DebugCommand),
  },
  {
    name: "providers",
    aliases: ["auth"],
    command: "providers",
    describe: "manage AI providers and credentials",
    load: () => import("./cmd/providers").then((m) => m.ProvidersCommand),
  },
  {
    name: "agent",
    command: "agent",
    describe: "manage agents",
    load: () => import("./cmd/agent").then((m) => m.AgentCommand),
  },
  {
    name: "upgrade",
    command: "upgrade [target]",
    describe: "upgrade RIFT to the latest or a specific version",
    load: () => import("./cmd/upgrade").then((m) => m.UpgradeCommand),
  },
  {
    name: "uninstall",
    command: "uninstall",
    describe: "uninstall opencode and remove all related files",
    load: () => import("./cmd/uninstall").then((m) => m.UninstallCommand),
  },
  {
    name: "serve",
    command: "serve",
    describe: "starts a headless opencode server",
    load: () => import("./cmd/serve").then((m) => m.ServeCommand),
  },
  {
    name: "models",
    command: "models [provider]",
    describe: "list all available models",
    load: () => import("./cmd/models").then((m) => m.ModelsCommand),
  },
  {
    name: "export",
    command: "export [sessionID]",
    describe: "export session data as JSON",
    load: () => import("./cmd/export").then((m) => m.ExportCommand),
  },
  {
    name: "video",
    command: "video",
    describe: "make animated videos from a brief",
    load: () => import("./cmd/video").then((m) => m.VideoCommand),
  },
  {
    name: "import",
    command: "import <file>",
    describe: "import a session from a JSON file or a RIFT share link",
    load: () => import("./cmd/import").then((m) => m.ImportCommand),
  },
  {
    name: "pr",
    command: "pr <number>",
    describe: "fetch and checkout a GitHub PR branch, then run RIFT",
    load: () => import("./cmd/pr").then((m) => m.PrCommand),
  },
  {
    name: "session",
    command: "session",
    describe: "manage sessions",
    load: () => import("./cmd/session").then((m) => m.SessionCommand),
  },
]

// Options that take a separate value, so the token after them is not a command name.
const VALUE_FLAGS = new Set([
  "--log-level",
  "--model",
  "-m",
  "--session",
  "-s",
  "--agent",
  "--prompt",
  "--port",
  "--hostname",
  "--mdns-domain",
  "--cors",
  "--replay-limit",
])

/** The command the arguments select: the first positional, if it names a command or alias. */
export function select(args: string[]): CommandEntry | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--") return undefined
    if (VALUE_FLAGS.has(arg)) {
      i++
      continue
    }
    if (arg.startsWith("-")) continue
    return commands.find((entry) => entry.name === arg || entry.aliases?.includes(arg))
  }
  return undefined
}

/** A command definition with no builder or handler, enough for help output. */
export function stub(entry: CommandEntry): CommandModule {
  return {
    command: entry.command,
    describe: entry.describe,
    ...(entry.aliases ? { aliases: entry.aliases } : {}),
    handler: () => {},
  }
}
