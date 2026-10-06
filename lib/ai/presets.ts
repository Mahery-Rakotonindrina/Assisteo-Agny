import type { Protocol } from "./schema";

// Shortcuts for the providers people use most. Anything else works through
// "custom" with an OpenAI-compatible base URL. Model names are not hard-coded
// beyond a couple of examples: the settings screen loads the real list with
// the user's key.

export type ProviderPreset = {
  id: string;
  name: string;
  protocol: Protocol;
  /** OpenAI-compatible base URL; empty for "custom", where the user types it. */
  baseUrl?: string;
  keyUrl?: string;
  keyPlaceholder: string;
  /** Offers a free tier, worth pointing out to users after the trial. */
  free?: boolean;
  suggestedModels: string[];
};

export const providerPresets: ProviderPreset[] = [
  {
    id: "gemini",
    name: "Gemini",
    protocol: "gemini",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AIza… / AQ.…",
    free: true,
    suggestedModels: ["gemini-flash-latest", "gemini-flash-lite-latest"],
  },
  {
    id: "claude",
    name: "Claude",
    protocol: "claude",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    suggestedModels: [],
  },
  {
    id: "mistral",
    name: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "…",
    suggestedModels: [],
  },
  {
    id: "groq",
    name: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    free: true,
    suggestedModels: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    free: true,
    suggestedModels: [],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    suggestedModels: [],
  },
  {
    id: "together",
    name: "Together",
    protocol: "openai",
    baseUrl: "https://api.together.xyz/v1",
    keyUrl: "https://api.together.xyz/settings/api-keys",
    keyPlaceholder: "…",
    suggestedModels: [],
  },
  {
    id: "custom",
    name: "Autre / Other",
    protocol: "openai",
    keyPlaceholder: "…",
    suggestedModels: [],
  },
];

export function findPreset(id: string | undefined) {
  return providerPresets.find((preset) => preset.id === id);
}

/** Display name for a saved key, including custom APIs (shown by host). */
export function providerLabel(presetId: string | undefined, baseUrl?: string) {
  const preset = findPreset(presetId);
  if (preset && preset.id !== "custom") return preset.name;
  try {
    return baseUrl ? new URL(baseUrl).hostname.replace(/^api\./, "") : "API";
  } catch {
    return "API";
  }
}
