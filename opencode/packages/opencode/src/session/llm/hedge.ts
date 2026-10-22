/**
 * Hedged requests: if a model has not started answering `after` ms into a request, send the same
 * request again and keep whichever starts answering first. Free and shared endpoints sometimes
 * leave one request queued for minutes while a fresh one is answered in seconds; the first request
 * keeps running, so a hedge never makes a step slower.
 */

interface Attempt<T> {
  controller: AbortController
  buffer: T[]
  iterator?: AsyncIterator<T>
  ended: boolean
  failed: boolean
  error?: unknown
  // Resolves once the attempt starts answering, ends, or fails.
  settled: Promise<Attempt<T>>
}

export interface Input<T> {
  /** Starts attempt `index` (0 is the original request). */
  start: (signal: AbortSignal, index: number) => Promise<AsyncIterable<T>>
  after: number
  signal: AbortSignal
  /** A part that shows the model is answering (text, reasoning or a tool call). */
  ready: (part: T) => boolean
  /** A part that reports the request failed. */
  failed: (part: T) => boolean
  onHedge?: () => void
  onWinner?: (index: number) => void
}

function launch<T>(input: Input<T>, index: number): Attempt<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal.addEventListener("abort", abort, { once: true })
  controller.signal.addEventListener("abort", () => input.signal.removeEventListener("abort", abort), { once: true })
  const attempt: Attempt<T> = { controller, buffer: [], ended: false, failed: false, settled: undefined! }
  const pull = (): Promise<Attempt<T>> =>
    attempt.iterator!.next().then((next) => {
      if (next.done) {
        attempt.ended = true
        return attempt
      }
      attempt.buffer.push(next.value)
      if (input.failed(next.value)) attempt.failed = true
      if (attempt.failed || input.ready(next.value)) return attempt
      return pull()
    })
  attempt.settled = input
    .start(controller.signal, index)
    .then((iterable) => {
      attempt.iterator = iterable[Symbol.asyncIterator]()
      return pull()
    })
    .catch((error: unknown) => {
      attempt.failed = true
      attempt.error = error
      return attempt
    })
  return attempt
}

function late(attempt: Attempt<unknown>, ms: number) {
  return new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    void attempt.settled.then(() => clearTimeout(timer))
  })
}

function cancel(attempt: Attempt<unknown>) {
  attempt.controller.abort()
  void attempt.iterator?.return?.().catch(() => undefined)
}

async function pick<T>(input: Input<T>) {
  const first = launch(input, 0)
  if (input.after <= 0) return first.settled
  const early = await Promise.race([first.settled, late(first, input.after)])
  if (early) return first
  if (input.signal.aborted) return first
  input.onHedge?.()
  const second = launch(input, 1)
  const fastest = await Promise.race([first.settled, second.settled])
  const other = fastest === first ? second : first
  // A request that only failed does not win while the other one may still answer.
  const winner = fastest.failed ? await other.settled.then((result) => (result.failed ? fastest : result)) : fastest
  cancel(winner === first ? second : first)
  input.onWinner?.(winner === first ? 0 : 1)
  return winner
}

/**
 * The winning request's parts. A plain iterator rather than an async generator: a generator cannot
 * be stopped while it waits for the first token, which would block cancelling the step.
 */
export function race<T>(input: Input<T>): AsyncIterable<T> {
  const stop = new AbortController()
  const abort = () => stop.abort()
  input.signal.addEventListener("abort", abort, { once: true })
  let winner: Promise<Attempt<T>> | undefined
  let index = 0
  let thrown = false
  const done = { done: true as const, value: undefined }
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<T>> => {
        winner ??= pick({ ...input, signal: stop.signal })
        const attempt = await winner
        if (index < attempt.buffer.length) return { done: false, value: attempt.buffer[index++]! }
        if (attempt.error !== undefined && !thrown) {
          thrown = true
          throw attempt.error
        }
        if (attempt.ended || !attempt.iterator || thrown || stop.signal.aborted) return done
        return attempt.iterator.next()
      },
      return: async (): Promise<IteratorResult<T>> => {
        input.signal.removeEventListener("abort", abort)
        stop.abort()
        void winner?.then(cancel)
        return done
      },
    }),
  }
}

export * as Hedge from "./hedge"
