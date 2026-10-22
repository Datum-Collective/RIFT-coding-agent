import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { RiftVersion } from "@opencode-ai/core/installation/version"
import { Journey } from "@opencode-ai/core/installation/journey"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade RIFT to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`RIFT is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    // Compared against RIFT's own release number. The runtime version the binary is built on is a
    // different sequence, and comparing the two makes every release look like an upgrade.
    if (RiftVersion === target) {
      prompts.log.warn(`RIFT upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${RiftVersion} → ${target}`)
    // On a real terminal the update walks from the Shire to Mount Doom; anywhere else (pipes, CI) it
    // is the plain spinner it always was.
    const animated = Journey.interactive(process.stdout, process.env)
    const spinner = animated ? undefined : prompts.spinner()
    spinner?.start("Upgrading...")
    const upgrade = Installation.upgrade(method, target)
    const restoreCursor = () => process.stdout.write(Journey.SHOW_CURSOR)
    if (animated) process.once("exit", restoreCursor)
    const arrived = await Journey.play(upgrade, { write: (text) => process.stdout.write(text), interactive: animated })
    if (animated) process.off("exit", restoreCursor)
    const err = arrived ? undefined : await upgrade.then(() => undefined, (err) => err)
    if (err) {
      if (spinner) spinner.stop("Upgrade failed", 1)
      if (!spinner) prompts.log.error("Upgrade failed")
      if (err instanceof Installation.UpgradeFailedError) {
        // necessary because choco only allows install/upgrade in elevated terminals
        if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else {
          prompts.log.error(err.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    if (spinner) spinner.stop("Upgrade complete")
    if (!spinner) prompts.log.success("Upgrade complete")
    if (!spinner) prompts.log.message(`"${Journey.quote(target)}"`)
    prompts.outro("Done")
  },
}
