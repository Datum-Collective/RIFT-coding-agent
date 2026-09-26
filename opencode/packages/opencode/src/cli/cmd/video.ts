import { spawnSync } from "child_process"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { scaffold } from "../../video/scaffold"

const VideoInitCommand = cmd({
  command: "init",
  describe: "set up the RIFT video engine in this project",
  builder: (yargs) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "where to put it (default: video/, or .rift/video if video/ is taken)",
      })
      .option("install", { type: "boolean", default: true, describe: "run npm install afterwards" }),
  async handler(args) {
    const root = process.cwd()
    const result = await scaffold(root, { dir: args.dir })
    const where = path.relative(root, result.dir) || "."
    if (!result.created) {
      UI.println(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} video engine already in ${where}`)
      return
    }
    UI.println(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} video engine written to ${where}`)
    if (!args.install) return
    // Remotion renders with Node, so the engine needs Node and npm even though RIFT does not.
    const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: result.dir, stdio: "inherit" })
    if (npm.error || npm.status !== 0) {
      UI.error(`npm install failed in ${where}. Install Node 20+ (nodejs.org), then run: cd ${where} && npm install`)
      process.exitCode = 1
      return
    }
    UI.println(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} ready · cd ${where} && npm run dev`)
  },
})

export const VideoCommand = cmd({
  command: "video",
  describe: "make animated videos from a brief",
  builder: (yargs) => yargs.command(VideoInitCommand).demandCommand(),
  async handler() {},
})
