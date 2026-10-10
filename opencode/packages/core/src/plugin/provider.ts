import { AnthropicPlugin } from "./provider/anthropic"
import { DynamicProviderPlugin } from "./provider/dynamic"
import { GithubCopilotPlugin } from "./provider/github-copilot"
import { GooglePlugin } from "./provider/google"
import { GroqPlugin } from "./provider/groq"
import { MistralPlugin } from "./provider/mistral"
import { OpenAIPlugin } from "./provider/openai"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { OpencodePlugin } from "./provider/opencode"
import { OpenRouterPlugin } from "./provider/openrouter"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  AnthropicPlugin,
  GithubCopilotPlugin,
  GooglePlugin,
  GroqPlugin,
  MistralPlugin,
  OpencodePlugin,
  OpenAICompatiblePlugin,
  OpenAIPlugin,
  OpenRouterPlugin,
  DynamicProviderPlugin,
]
