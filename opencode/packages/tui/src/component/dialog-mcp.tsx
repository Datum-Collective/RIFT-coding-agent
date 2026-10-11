import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import type { McpServer } from "@opencode-ai/sdk/v2"
import { useSync } from "../context/sync"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"

type Status = McpServer["status"]["status"]

function label(server: McpServer) {
  const status = server.status
  switch (status.status) {
    case "connected":
      return `${server.tools.length} tools`
    case "pending":
      return "not started"
    case "connecting":
      return "connecting"
    case "disabled":
      return "disabled"
    case "needs_approval":
      return "needs approval"
    case "needs_auth":
      return "needs sign-in"
    case "needs_client_registration":
      return "needs client id"
    case "failed":
      return "failed"
  }
}

function StatusText(props: { server: McpServer; busy: boolean }) {
  const { theme } = useTheme()
  const color = (status: Status) => {
    if (status === "connected") return theme.success
    if (status === "failed" || status === "needs_client_registration") return theme.error
    if (status === "needs_approval" || status === "needs_auth") return theme.warning
    return theme.textMuted
  }
  return (
    <span style={{ fg: props.busy ? theme.textMuted : color(props.server.status.status) }}>
      {props.busy ? "working" : label(props.server)}
    </span>
  )
}

/** Asks whether a project's .mcp.json server may start. */
export function DialogMcpApproval(props: { server: McpServer; onDone?: () => void }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const decide = async (decision: "once" | "always" | "deny") => {
    await sdk.client.mcp.approve({ name: props.server.name, decision })
    dialog.clear()
    props.onDone?.()
  }
  return (
    <DialogSelect
      title={`Start "${props.server.name}" from this project's .mcp.json?`}
      placeholder={props.server.target}
      skipFilter
      options={[
        { title: "Allow once", value: "once" as const, description: "for this run only" },
        { title: "Always allow", value: "always" as const, description: "remembered for this project" },
        { title: "Deny", value: "deny" as const, description: "remembered; change it in /mcp" },
      ]}
      onSelect={(option) => void decide(option.value)}
    />
  )
}

function DialogMcpTools(props: { server: McpServer }) {
  return (
    <DialogSelect
      title={`${props.server.name}: ${props.server.tools.length} tools`}
      options={props.server.tools.map((tool) => ({
        title: tool,
        value: tool,
        description: `mcp__${props.server.name.replace(/[^a-zA-Z0-9_-]/g, "_")}__${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      }))}
    />
  )
}

export function DialogMcp() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [servers, setServers] = createSignal<McpServer[]>([])
  const [busy, setBusy] = createSignal<string | null>(null)

  // Opening /mcp starts any server that has not started yet; the list refreshes as they connect.
  const refresh = () =>
    sdk.client.mcp.servers({ start: "true" }).then((x) => {
      if (x.data) setServers(x.data)
    })
  onMount(() => void refresh())
  createEffect(() => {
    JSON.stringify(sync.data.mcp)
    void refresh()
  })

  const run = async (name: string, action: () => Promise<unknown>) => {
    if (busy() !== null) return
    setBusy(name)
    try {
      await action()
    } catch (error) {
      toast.show({ variant: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const byName = (name: string) => servers().find((server) => server.name === name)

  const options = createMemo(() =>
    servers().map(
      (server): DialogSelectOption<string> => ({
        value: server.name,
        title: server.name,
        description: `${server.scope} · ${server.type === "remote" ? "http" : "stdio"}${server.auth ? ` · ${server.auth.replace("_", " ")}` : ""}`,
        details: server.status.status === "failed" || server.status.status === "needs_client_registration"
          ? [server.status.error]
          : undefined,
        footer: <StatusText server={server} busy={busy() === server.name} />,
      }),
    ),
  )

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: "on/off",
      onTrigger: (option: DialogSelectOption<string>): void => {
        const server = byName(option.value)
        if (!server) return
        const on = server.status.status !== "disabled"
        void run(option.value, () =>
          on ? sdk.client.mcp.disconnect({ name: option.value }) : sdk.client.mcp.connect({ name: option.value }),
        )
      },
    },
    {
      command: "dialog.mcp.reconnect",
      title: "reconnect",
      onTrigger: (option: DialogSelectOption<string>): void => {
        void run(option.value, () => sdk.client.mcp.connect({ name: option.value }))
      },
    },
    {
      command: "dialog.mcp.auth",
      title: "sign in",
      disabled: (option: DialogSelectOption<string> | undefined) => !option || !byName(option.value)?.auth,
      onTrigger: (option: DialogSelectOption<string>): void => {
        void run(option.value, () => sdk.client.mcp.auth.authenticate({ name: option.value }))
      },
    },
  ])

  return (
    <DialogSelect
      title="MCP servers"
      options={options()}
      actions={actions()}
      emptyView={<text>No MCP servers. Add one with: rift mcp add &lt;name&gt; -- &lt;command&gt;</text>}
      onSelect={(option) => {
        const server = byName(option.value)
        if (!server) return
        if (server.status.status === "needs_approval")
          return dialog.replace(() => <DialogMcpApproval server={server} onDone={() => dialog.replace(() => <DialogMcp />)} />)
        if (server.tools.length) return dialog.replace(() => <DialogMcpTools server={server} />)
      }}
    />
  )
}
