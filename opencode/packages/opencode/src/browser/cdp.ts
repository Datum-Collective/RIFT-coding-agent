/**
 * A small Chrome DevTools Protocol client.
 *
 * CDP is a JSON-RPC stream over a WebSocket: commands carry an id and are answered by a frame
 * with the same id, and anything without an id is an event. That is the whole protocol, so a
 * driver fits in a few dozen lines and RIFT needs no browser-automation dependency.
 */
export type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
  sessionId?: string
}

export type CdpEvent = {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

/** Routes replies to their waiting caller and events to listeners. */
export class CdpSession {
  private nextID = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >()
  private readonly listeners = new Set<(event: CdpEvent) => void>()
  private closedReason?: string

  constructor(private readonly send: (payload: string) => void) {}

  /** Feeds one raw frame in. Unparseable frames are ignored rather than killing the session. */
  receive(raw: string) {
    let message: CdpMessage
    try {
      message = JSON.parse(raw) as CdpMessage
    } catch {
      return
    }
    if (typeof message.id === "number") {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP command failed"))
      else waiter.resolve(message.result ?? {})
      return
    }
    if (!message.method) return
    const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId }
    for (const listener of this.listeners) listener(event)
  }

  on(listener: (event: CdpEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Sends a command and resolves with its result. Rejects if the session closes first. */
  command(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    if (this.closedReason) return Promise.reject(new Error(this.closedReason))
    const id = this.nextID++
    const payload: CdpMessage = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.send(JSON.stringify(payload))
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Resolves when an event arrives, or rejects on timeout so a hung page cannot hang the agent. */
  waitFor(method: string, timeoutMs: number) {
    return new Promise<CdpEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${method}`))
      }, timeoutMs)
      const off = this.on((event) => {
        if (event.method !== method) return
        clearTimeout(timer)
        off()
        resolve(event)
      })
    })
  }

  /** Fails every in-flight command so no caller waits on a dead socket. */
  close(reason = "browser session closed") {
    this.closedReason = reason
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
    this.pending.clear()
    this.listeners.clear()
  }
}
