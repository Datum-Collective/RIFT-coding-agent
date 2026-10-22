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

const COMMAND_TIMEOUT_MS = 30_000

/** Routes replies to their waiting caller and events to listeners. */
export class CdpSession {
  private nextID = 1
  private readonly pending = new Map<
    number,
    { sessionId?: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >()
  private readonly listeners = new Set<(event: CdpEvent) => void>()
  private readonly waiters = new Set<{ sessionId?: string; reject: (error: Error) => void }>()
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

  /**
   * Sends a command and resolves with its result. Rejects if the session closes first, or when the
   * browser does not answer in time: a stuck page used to hang the agent's turn with no end.
   */
  command(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (this.closedReason) return Promise.reject(new Error(this.closedReason))
    const id = this.nextID++
    const payload: CdpMessage = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`browser did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, {
        sessionId,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.send(JSON.stringify(payload))
      } catch (error) {
        this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)))
        this.pending.delete(id)
      }
    })
  }

  /**
   * Resolves when an event arrives (from one tab, given its session), or rejects on timeout so a
   * hung page cannot hang the agent.
   */
  waitFor(method: string, timeoutMs: number, sessionId?: string) {
    return new Promise<CdpEvent>((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        off()
        this.waiters.delete(waiter)
      }
      const waiter = {
        sessionId,
        reject: (error: Error) => {
          settle()
          reject(error)
        },
      }
      const timer = setTimeout(
        () => waiter.reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${method}`)),
        timeoutMs,
      )
      const off = this.on((event) => {
        if (event.method !== method || (sessionId && event.sessionId !== sessionId)) return
        settle()
        resolve(event)
      })
      this.waiters.add(waiter)
    })
  }

  get closed() {
    return this.closedReason !== undefined
  }

  /** Fails the commands and waits on one tab, for when that tab crashed and will never answer. */
  fail(sessionId: string, reason: string) {
    for (const [id, waiter] of this.pending) {
      if (waiter.sessionId !== sessionId) continue
      this.pending.delete(id)
      waiter.reject(new Error(reason))
    }
    for (const waiter of this.waiters) if (waiter.sessionId === sessionId) waiter.reject(new Error(reason))
  }

  /** Fails every in-flight command so no caller waits on a dead socket. */
  close(reason = "browser session closed") {
    this.closedReason = reason
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
    this.pending.clear()
    for (const waiter of this.waiters) waiter.reject(new Error(reason))
    this.listeners.clear()
  }
}
