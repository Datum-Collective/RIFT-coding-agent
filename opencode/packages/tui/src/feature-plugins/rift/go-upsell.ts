/**
 * RIFT promises model usage is "billed by whichever provider you pick, never by RIFT" (README). OpenCode's own
 * free-tier limit triggers an upsell for OpenCode's unrelated "Go" subscription (opencode.ai/go) — a product
 * RIFT users never asked for. Off by default; RIFT_GO_UPSELL=1 restores upstream's behaviour.
 */
export function shouldShowGoUpsell(env: Record<string, string | undefined>) {
  const value = (env.RIFT_GO_UPSELL ?? "").toLowerCase()
  return value === "1" || value === "true"
}
