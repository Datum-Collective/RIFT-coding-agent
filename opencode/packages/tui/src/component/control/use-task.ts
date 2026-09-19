/**
 * Adapts the shared sync store to the task model. Kept thin: every rule about what a task
 * means lives in util/task.ts, and this only maps fields.
 */
import { createMemo, type Accessor } from "solid-js"
import { useSync } from "../../context/sync"
import { useLocal } from "../../context/local"
import { task as deriveTask, type Task, type TaskInput, type TaskPart } from "../../util/task"

type Sync = ReturnType<typeof useSync>

export function taskInput(sync: Sync, sessionID: string, models?: TaskInput["models"]): TaskInput {
  const status = sync.data.session_status[sessionID]
  return {
    title: sync.session.get(sessionID)?.title,
    messages: (sync.data.message[sessionID] ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      mode: "mode" in message ? message.mode : undefined,
      modelID: "modelID" in message ? message.modelID : undefined,
      providerID: "providerID" in message ? message.providerID : undefined,
      agent: "agent" in message ? message.agent : undefined,
      tokens: "tokens" in message ? message.tokens : undefined,
    })),
    // One documented boundary cast: SDK parts carry more than the task model reads.
    parts: (messageID) => (sync.data.part[messageID] ?? []) as unknown as readonly TaskPart[],
    diff: (sync.data.session_diff[sessionID] ?? []).flatMap((item) =>
      item.file === undefined ? [] : [{ file: item.file, added: item.additions ?? 0, removed: item.deletions ?? 0 }],
    ),
    todos: sync.data.todo[sessionID] ?? [],
    busy: status?.type === "busy" || status?.type === "retry",
    permissions: (sync.data.permission[sessionID] ?? []).length,
    questions: (sync.data.question[sessionID] ?? []).length,
    models,
    cost: sync.session.get(sessionID)?.cost ?? 0,
    contextLimit: (message) =>
      message.providerID && message.modelID
        ? sync.data.provider.find((item) => item.id === message.providerID)?.models[message.modelID]?.limit.context
        : undefined,
  }
}

/** Live task model for one session. */
export function useTask(sessionID: Accessor<string>): Accessor<Task> {
  const sync = useSync()
  const local = useLocal()
  return createMemo(() => {
    // Planner/executor only mean something in Vibe Mode; elsewhere show the single model.
    const vibe = local.agent.current()?.name === "vibe" && local.agent.vibe.configured()
    return deriveTask(
      taskInput(sync, sessionID(), {
        planner: vibe ? local.agent.vibe.modelLabel("planner") : undefined,
        executor: vibe ? local.agent.vibe.modelLabel("executor") : undefined,
        current: local.model.current()?.modelID,
      }),
    )
  })
}
