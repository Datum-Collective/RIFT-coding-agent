import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { RoundedBorder } from "./border"
export type ToastOptions = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
}
type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

const GLYPH = { info: "·", success: "✓", warning: "!", error: "✕" } as const

/** A notice in the top-right corner: a glyph, an optional bold title, the message. No frame. */
export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          top={1}
          right={1}
          maxWidth={Math.min(64, dimensions().width - 4)}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.backgroundPanel}
          border
          customBorderChars={RoundedBorder}
          borderColor={current().variant === "info" ? theme.borderSubtle : theme[current().variant]}
          flexDirection="row"
        >
          <text width={2} flexShrink={0} fg={current().variant === "info" ? theme.primary : theme[current().variant]}>
            {GLYPH[current().variant]}
          </text>
          <text fg={current().variant === "error" ? theme.error : theme.textMuted} wrapMode="word" flexShrink={1}>
            <Show when={current().title}>
              <span style={{ fg: theme.text, bold: true }}>{current().title} </span>
            </Show>
            {current().message}
          </text>
        </box>
      )}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  const toast = {
    show(options: ToastInput) {
      const toastOptions = { ...options, duration: options.duration ?? 5000 }
      setStore("currentToast", toastOptions)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, toastOptions.duration).unref()
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
