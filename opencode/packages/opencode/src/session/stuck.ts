import type { SessionV1 } from "@opencode-ai/core/v1/session"

/**
 * Catches a model that keeps taking steps that do nothing: free models sometimes say "now click
 * the button" and emit `bash true` instead, dozens of times, each costing a full model round trip.
 * The per-step doom-loop check never sees this, since every no-op lands in a separate step.
 */

export const STEPS = 2
const NO_OP = /^\s*(true|:|pwd|ls|echo(\s[^>|;&`$]*)?)\s*$/
// Commands with no effect at all; the shell tool answers these without running them.
const NOTHING = /^\s*(true|:)\s*$/

export function nothing(command: string) {
  return command !== "" && NOTHING.test(command)
}

export function nothingReply(command: string) {
  return `Not run: \`${command.trim()}\` does nothing. If you meant to use another tool (browser, read, edit, task...), call that tool directly now; otherwise go on with the task.`
}

type Call = { tool: string; input: string }

function calls(message: SessionV1.WithParts): Call[] | undefined {
  const tools = message.parts.flatMap((part) =>
    part.type === "tool" ? [{ tool: part.tool, input: JSON.stringify(part.state.input) }] : [],
  )
  return tools.length > 0 ? tools : undefined
}

function command(call: Call) {
  if (call.tool !== "bash") return ""
  const value = (JSON.parse(call.input) as { command?: unknown }).command
  return typeof value === "string" ? value : ""
}

function idle(call: Call, previous: Call[] | undefined) {
  if (previous?.some((item) => item.tool === call.tool && item.input === call.input)) return true
  return call.tool === "bash" && NO_OP.test(command(call))
}

/**
 * When the turn's last STEPS steps only ran no-op or repeated calls: a reminder for the model and,
 * if it named exactly one tool it meant to use, that tool, so the next request can require it.
 */
export function check(messages: SessionV1.WithParts[], tools: string[]) {
  const start = messages.findLastIndex((message) => message.info.role === "user")
  const steps = messages.slice(start + 1).filter((message) => message.info.role === "assistant")
  const last = steps.at(-1)
  if (!last) return
  const thought = last.parts
    .flatMap((part) => (part.type === "reasoning" || part.type === "text" ? [part.text] : []))
    .join(" ")
  const meant = tools.filter((tool) => tool !== "bash" && new RegExp(`\\b${tool}\\b`).test(thought))
  // One `true` while saying "now the browser tool" is already the glitch; waiting for a second
  // costs a round trip each time it alternates with real calls.
  const slip = meant.length === 1 && (calls(last)?.every((call) => nothing(command(call))) ?? false)
  const recent = steps.slice(-STEPS - 1)
  const window = recent.slice(-STEPS)
  const offset = recent.length - window.length
  const stuck =
    window.length === STEPS &&
    window.every((message, i) => {
      const current = calls(message)
      const previous = i + offset > 0 ? calls(recent[i + offset - 1]!) : undefined
      return current?.every((call) => idle(call, previous)) ?? false
    })
  if (!stuck && !slip) return
  const reminder = [
    "<system-reminder>",
    `Your last ${stuck ? `${STEPS} steps` : "step"} only ran calls that do nothing (${calls(last)!
      .map((call) => `\`${call.tool} ${call.input}\``)
      .join(", ")}).`,
    meant.length > 0
      ? `You said you would use ${meant.map((tool) => `\`${tool}\``).join(", ")}: call that tool directly now, by its name, with its arguments.`
      : "Call the tool you actually mean directly now, by its name, with its arguments.",
    "If the work is done, stop calling tools and reply.",
    "</system-reminder>",
  ].join("\n")
  return { reminder, force: meant.length === 1 ? meant[0] : undefined }
}

export * as Stuck from "./stuck"
