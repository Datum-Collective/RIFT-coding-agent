import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { EOL } from "os"
import { RiftVersion } from "@opencode-ai/core/installation/version"
import type { CommandModule } from "yargs"
import { commands, select, stub } from "./cli/commands"

const args = hideBin(process.argv)

// `rift --version` is by far the most frequent invocation from scripts and update checks; it must
// not pay for the command modules, Effect or the runtime. Same output as yargs' own handler.
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  process.stdout.write(RiftVersion + EOL)
  process.exit(0)
}

const { UI } = await import("./cli/ui")
const { FormatError } = await import("./cli/error")
const { errorMessage } = await import("./util/error")

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

// Only the selected command is imported. The others are registered as name-and-description stubs so
// `rift --help` still lists them. With no command selected the default one (the TUI) is loaded,
// which is also what top-level `--help` needs for its option list.
const selected = select(args)
const loaded = await Promise.all(
  commands.map(async (entry) => {
    const wanted = selected ? entry === selected : entry.name === undefined
    return wanted ? ((await entry.load()) as CommandModule) : stub(entry)
  }),
)

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  // The RIFT release, which is what people compare with GitHub. The OpenCode runtime it is built on
  // is in `rift debug info`.
  .version("version", "show version number", RiftVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    const { Heap } = await import("./cli/heap")
    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(loaded as any)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
