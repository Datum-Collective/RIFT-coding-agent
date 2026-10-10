import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema() {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "Command to run" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "Timeout in ms" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: "Directory to run in; use instead of cd",
    }),
  })
}

export const Parameters = parameterSchema()
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

function powershellNotes(name: string) {
  if (name === "pwsh") {
    return "PowerShell 7 notes: `&&` and `||` work; use full cmdlet names; call executables with spaces in the path as `& \"path\" args`."
  }
  if (name === "powershell") {
    return "Windows PowerShell 5.1 notes: no `&&`; use full cmdlet names; call executables with spaces in the path as `& \"path\" args`."
  }
  return ""
}

function chainGuidance(name: string) {
  if (name === "powershell") return "Chain dependent commands with `cmd1; if ($?) { cmd2 }` (5.1 has no `&&`)."
  return "Chain dependent commands with `&&`."
}

function limitsLine(limits: Limits, defaultTimeoutMs: number) {
  return `Default timeout ${defaultTimeoutMs}ms (set \`timeout\` to change). Output over ${limits.maxLines} lines or ${limits.maxBytes} bytes is truncated to a file you can read or grep; do not pipe through head or tail.`
}

function bashCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return [
    "- Quote paths that contain spaces. Pass `workdir` instead of using `cd`.",
    `- Run independent commands as parallel tool calls. ${chain}`,
    `- ${limitsLine(limits, defaultTimeoutMs)}`,
  ].join("\n")
}

function powershellCommandSection(
  name: string,
  chain: string,
  _pathSep: string,
  limits: Limits,
  defaultTimeoutMs: number,
) {
  return [
    powershellNotes(name),
    "- Quote paths that contain spaces. Pass `workdir` instead of `Set-Location`.",
    `- Run independent commands as parallel tool calls. ${chain}`,
    `- ${limitsLine(limits, defaultTimeoutMs)}`,
  ].join("\n")
}

function cmdCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return [
    "cmd.exe notes: quote paths with spaces, use %VAR% for variables, `call` for batch files.",
    "- Pass `workdir` instead of `cd`.",
    `- Run independent commands as parallel tool calls. ${chain}`,
    `- ${limitsLine(limits, defaultTimeoutMs)}`,
  ].join("\n")
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `Run a ${shellDisplayName(name)} command.`,
      workdirSection:
        "Commands run in the current directory unless `workdir` is given.",
      commandSection: cmdCommandSection(chain, limits, defaultTimeoutMs),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using a temporary body file so cmd.exe quoting stays simple.",
      createPrExample: `(\n  echo ## Summary\n  echo - ^<1-3 bullet points^>\n) > pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
    }
  }
  if (isPowerShell) {
    return {
      intro: `Run a ${shellDisplayName(name)} command.`,
      workdirSection:
        "Commands run in the current directory unless `workdir` is given.",
      commandSection: powershellCommandSection(
        name,
        chain,
        platform === "win32" ? "\\" : "/",
        limits,
        defaultTimeoutMs,
      ),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using gh pr create with a PowerShell here-string to pass the body correctly.",
      createPrExample: `gh pr create --title "the pr title" --body @'
## Summary
- <1-3 bullet points>
'@`,
    }
  }
  return {
    intro: "Run a bash command.",
    workdirSection:
      "Commands run in the current directory unless `workdir` is given.",
    commandSection: bashCommandSection(chain, limits, defaultTimeoutMs),
    gitCommands: "bash commands",
    gitCommandRestriction: "git bash commands",
    createPrInstruction:
      "Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.",
    createPrExample: `gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>`,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const selected = profile(name, platform, limits, defaultTimeoutMs)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(),
  }
}

export * as ShellPrompt from "./prompt"
