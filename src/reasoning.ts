// Owns the one canonical scale syd exposes and its translation into each SDK's
// dialect, so no UI code ever learns a provider's spelling.

import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ProviderId } from "./providers.ts";

// The intersection of what every provider supports, not the union: OpenAI also
// takes "minimal"/"xhigh"/"max", but Google stops at "high" and Anthropic has no
// named levels. A level that silently does nothing on half the providers is
// worse than not offering it.
//
// "default" sends no option at all, so a model with no reasoning support never
// receives a parameter it would reject.
export type ReasoningLevel = "default" | "off" | "low" | "medium" | "high";

export const REASONING_LEVELS: readonly ReasoningLevel[] = [
  "default",
  "off",
  "low",
  "medium",
  "high",
];

export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "default";

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    typeof value === "string" &&
    REASONING_LEVELS.includes(value as ReasoningLevel)
  );
}

// Thinking counts toward max_tokens and the API rejects a budget that meets or
// exceeds it. The smallest output cap among thinking-capable Claude models is
// 8192, so "high" stays under that rather than at the larger budget a newer
// model could take — under-asking on one beats hard-failing on another. 1024 is
// the API's own minimum for an enabled thinking block.
const ANTHROPIC_BUDGET: Record<"low" | "medium" | "high", number> = {
  low: 1024,
  medium: 4096,
  high: 8000,
};

// The namespace is keyed by SDK dialect, not syd's ProviderId — "openai" and
// "openai-chatgpt" share one, since ChatGPT is the same Responses API.
export function reasoningOptions(
  provider: ProviderId,
  level: ReasoningLevel,
): ProviderOptions | undefined {
  if (level === "default") return undefined;

  switch (provider) {
    case "openai":
    case "openai-chatgpt":
      // "none" is OpenAI's own spelling for "don't reason".
      return { openai: { reasoningEffort: level === "off" ? "none" : level } };

    case "google":
      // Google has no "off" level — a zero budget is how you disable thinking.
      return {
        google: {
          thinkingConfig:
            level === "off" ? { thinkingBudget: 0 } : { thinkingLevel: level },
        },
      };

    case "anthropic":
      return {
        anthropic: {
          thinking:
            level === "off"
              ? { type: "disabled" }
              : { type: "enabled", budgetTokens: ANTHROPIC_BUDGET[level] },
        },
      };
  }
}

// One level deep, so `{ openai: { store: false } }` and
// `{ openai: { reasoningEffort: "high" } }` combine instead of clobbering.
// Later arguments win on a key collision.
export function mergeProviderOptions(
  ...parts: (ProviderOptions | undefined)[]
): ProviderOptions | undefined {
  const present = parts.filter((p): p is ProviderOptions => p !== undefined);
  if (present.length === 0) return undefined;

  const merged: ProviderOptions = {};
  for (const part of present) {
    for (const [namespace, options] of Object.entries(part)) {
      merged[namespace] = { ...merged[namespace], ...options };
    }
  }
  return merged;
}
