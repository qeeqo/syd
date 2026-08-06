// Centralize provider dialects so UI code uses one scale.

import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ProviderId } from "./providers.ts";

// Expose the cross-provider intersection; provider-only levels would silently
// do nothing elsewhere. `default` omits options for unsupported models.
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

// Anthropic requires 1024 <= budget < max_tokens. Keep `high` below the
// smallest supported output cap (8192) to avoid model-dependent failures.
const ANTHROPIC_BUDGET: Record<"low" | "medium" | "high", number> = {
  low: 1024,
  medium: 4096,
  high: 8000,
};

// SDK namespaces differ from provider IDs; both OpenAI routes share one.
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

// Merge one namespace level so reasoning does not overwrite options such as
// store:false; later keys win.
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
