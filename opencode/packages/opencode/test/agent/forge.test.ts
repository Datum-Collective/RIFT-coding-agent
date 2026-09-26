import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Agent.node, Plugin.node, Provider.node, Auth.node, Config.node, Skill.node, RuntimeFlags.node]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const get = (name: string) => Agent.Service.use((svc) => svc.get(name))

it.instance("forge is a native primary agent with its own prompt", () =>
  Effect.gen(function* () {
    const forge = yield* get("forge")
    expect(forge.mode).toBe("primary")
    expect(forge.native).toBe(true)
    expect(forge.prompt).toContain("RIFT Forge")
  }),
)

it.instance("only the forge agent can see the forge tool", () =>
  Effect.gen(function* () {
    const forge = yield* get("forge")
    const build = yield* get("build")
    const general = yield* get("general")
    expect(Permission.disabled(["forge"], forge.permission).has("forge")).toBe(false)
    expect(Permission.disabled(["forge"], build.permission).has("forge")).toBe(true)
    expect(Permission.disabled(["forge"], general.permission).has("forge")).toBe(true)
  }),
)

it.instance(
  "a blanket allow in user config does not remove the human gate",
  () =>
    Effect.gen(function* () {
      const forge = yield* get("forge")
      expect(Permission.evaluate("forge_gate", "*", forge.permission).action).toBe("ask")
      expect(Permission.evaluate("bash", "*", forge.permission).action).toBe("allow")
    }),
  { config: { permission: { "*": "allow" } } },
)

it.instance(
  "agent-level config can still open the gate, for unattended runs",
  () =>
    Effect.gen(function* () {
      const forge = yield* get("forge")
      expect(Permission.evaluate("forge_gate", "*", forge.permission).action).toBe("allow")
    }),
  { config: { agent: { forge: { permission: { forge_gate: "allow" } } } } },
)
