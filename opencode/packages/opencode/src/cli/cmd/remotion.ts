// `rift remotion`: set up Remotion (https://www.remotion.dev) for making videos as React code.
// The know-how lives in Remotion's official Agent Skills (remotion-dev/skills); the `/remotion`
// command in a session drives them. This command only installs and launches things.
import { spawnSync } from "child_process"
import { cmd } from "./cmd"
import { UI } from "../ui"

/** Runs a command in the foreground; returns false (after explaining) when it is missing or fails. */
function run(command: string, args: string[], cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    UI.error(`${command} not found. Remotion needs Node 20+ (nodejs.org).`)
    return false
  }
  if (result.status !== 0) {
    UI.error(`${command} ${args.join(" ")} failed`)
    process.exitCode = result.status ?? 1
    return false
  }
  return true
}

const ok = (message: string) => UI.println(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} ${message}`)

const SetupCommand = cmd({
  command: "setup",
  describe: "install Remotion's Agent Skills (remotion-dev/skills)",
  builder: (yargs) =>
    yargs.option("global", {
      alias: "g",
      type: "boolean",
      default: false,
      describe: "install for your user (~/.claude/skills) instead of this project (.claude/skills)",
    }),
  async handler(args) {
    // Installed for Claude Code's layout, which RIFT reads, so the same skills serve both.
    const flags = ["-y", "skills@latest", "add", "remotion-dev/skills", "-a", "claude-code", "-s", "*", "-y"]
    if (args.global) flags.push("-g")
    if (!run("npx", flags)) return
    ok(`Remotion skills installed ${args.global ? "for your user" : "in this project"}. Type /remotion and a brief.`)
  },
})

const NewCommand = cmd({
  command: "new [name]",
  describe: "create a Remotion project (npx create-video)",
  builder: (yargs) =>
    yargs.positional("name", { type: "string", default: "my-video", describe: "folder to create" }),
  async handler(args) {
    const name = String(args.name)
    if (!run("npx", ["-y", "create-video@latest", "--yes", "--blank", "--no-tailwind", name])) return
    if (!run("npm", ["install", "--no-audit", "--no-fund"], name)) return
    ok(`Remotion project in ${name}. Preview with: rift remotion studio (from ${name})`)
  },
})

const StudioCommand = cmd({
  command: "studio",
  describe: "open Remotion Studio for the project in this folder",
  async handler() {
    run("npx", ["remotion", "studio"])
  },
})

export const RemotionCommand = cmd({
  command: "remotion",
  aliases: ["video"],
  describe: "make videos with Remotion",
  builder: (yargs) => yargs.command(SetupCommand).command(NewCommand).command(StudioCommand).demandCommand(),
  async handler() {},
})
