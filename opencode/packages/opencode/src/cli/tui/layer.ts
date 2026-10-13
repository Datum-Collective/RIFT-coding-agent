import { run as runTui, type TuiInput } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"

// Global.node binds nothing from the location service map, so it compiles on its own. Going through
// AppNodeBuilder would import every engine service just to build a layer that does not use them.
export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(LayerNode.compile(Global.node)))
}
