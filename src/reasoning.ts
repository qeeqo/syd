// Reasoning effort — pure module, no React, no TUI.
// Front-end agnostic like session.ts / skills.ts, so a headless core can reuse
// it.
//
// Every current frontier model can be told to think harder or less hard, but
// each provider spells it differently: OpenAI takes a named effort, Google
// takes a named level, Anthropic takes only a token budget. This module owns
// the single canonical scale syd exposes and the translation into each SDK's
// providerOptions shape — so chat.ts stays a thin choke point and no UI code
// ever learns a provider dialect.

import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ProviderId } from "./providers.ts";

// The canonical scale. Deliberately the intersection of what every provider
// supports rather than the union: OpenAI also accepts "minimal"/"xhigh"/"max"
// and the ChatGPT backend adds "ultra", but Google stops at "high" and
// Anthropic has no named levels at all. Offering a level that silently does
// nothing on two of four providers would be worse than not offering it.
//
// "default" is the important one: it sends no reasoning option at all, leaving
// each model at whatever its own default is. That's what makes this safe to
// ship on by default — a model with no reasoning support (gpt-4o,
// gemini-2.0-flash, claude-3-5) never receives a parameter it would reject.
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

// Anthropic is budget-based, so the named levels have to become token counts.
//
// The ceiling is the constraint that matters: extended thinking counts toward
// max_tokens, and the API rejects a budget that meets or exceeds it. The
// smallest output cap among thinking-capable Claude models is 8192 (Sonnet 3.7
// without the long-output beta header), so "high" stays just under that rather
// than at the much larger budget a Sonnet 5 could take. Better to under-ask on
// one model than to hard-fail the turn on another.
//
// 1024 is the API's own minimum for an enabled thinking block, so "low" sits
// exactly there.
const ANTHROPIC_BUDGET: Record<"low" | "medium" | "high", number> = {
  low: 1024,
  medium: 4096,
  high: 8000,
};

// Translate the canonical level into the provider's own option namespace.
// Returns undefined for "default" (send nothing) so the caller can skip the
// merge entirely.
//
// Note the namespace is keyed by SDK provider, not by syd's ProviderId: both
// "openai" and "openai-chatgpt" speak the OpenAI dialect, since the ChatGPT
// backend is the same Responses API behind an OAuth token.
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
      // thinkingLevel is the newer named form and is what the 3.x models take.
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

// Shallow-merge two providerOptions maps one level deep: namespaces are merged
// rather than replaced, so `{ openai: { store: false } }` and
// `{ openai: { reasoningEffort: "high" } }` combine instead of clobbering each
// other. Later arguments win on a key collision.
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
