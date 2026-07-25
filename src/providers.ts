// Provider registry — pure module, no React, no TUI.
// Single source of truth for which AI providers syd supports, how their
// models are resolved, and which env var holds each API key.
//
// Security invariants:
//   - Key VALUES flow through exactly one path: paste prompt → verifyApiKey
//     → auth store. They are never logged, rendered, or persisted anywhere
//     else; normal operation only checks *presence* (hasApiKey) and lets the
//     AI SDKs read process.env themselves.

import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderId = "google" | "anthropic" | "openai";

export type Provider = {
  id: ProviderId;
  label: string;
  // Env var the SDK reads the key from (Bun auto-loads .env at startup).
  envVar: string;
  // Model adopted when the user switches TO this provider — the previous
  // provider's model id would be meaningless here.
  defaultModel: string;
  resolve: (model: string) => LanguageModel;
  // Cheap authenticated GET (list-models) used both to verify a pasted key
  // before it's stored AND to populate the live model list. Costs nothing on
  // all three providers.
  verifyRequest: (key: string) => {
    url: string;
    headers: Record<string, string>;
  };
  // Parse the list-models response body into chat-capable model ids. Each
  // provider returns a different shape; `json` is untrusted (unknown), so
  // every access is defensive. Returns [] on anything unexpected.
  parseModels: (json: unknown) => string[];
};

// Narrow an untrusted value to an array of records, for defensive parsing.
function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
  );
}

export const providers: Record<ProviderId, Provider> = {
  google: {
    id: "google",
    label: "Google Gemini",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    resolve: (model) => google(model),
    verifyRequest: (key) => ({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: { "x-goog-api-key": key },
    }),
    // Google: { models: [{ name: "models/gemini-…", supportedGenerationMethods }] }.
    // Keep only text-chat models — those advertising generateContent, minus
    // the media/embedding variants that also list it (tts, image, embedding…).
    parseModels: (json) => {
      const models = asRecords((json as { models?: unknown })?.models);
      const skip = /embedding|aqa|-tts|image|imagen|veo|lyria|robotics/i;
      return models
        .filter((m) => {
          const methods = m.supportedGenerationMethods;
          return (
            Array.isArray(methods) && methods.includes("generateContent")
          );
        })
        .map((m) => (typeof m.name === "string" ? m.name : ""))
        .map((name) => name.replace(/^models\//, ""))
        .filter((name) => name.length > 0 && !skip.test(name));
    },
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5",
    resolve: (model) => anthropic(model),
    verifyRequest: (key) => ({
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    }),
    // Anthropic: { data: [{ id: "claude-…", type: "model" }] }. Every entry
    // is a chat model, so no filtering — just pull the ids.
    parseModels: (json) =>
      asRecords((json as { data?: unknown })?.data)
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter((id) => id.length > 0),
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.1",
    resolve: (model) => openai(model),
    verifyRequest: (key) => ({
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${key}` },
    }),
    // OpenAI: { data: [{ id: "gpt-…" }] } — but the list mixes in embeddings,
    // audio, image, and moderation models with no "is chat" flag. A denylist
    // (not an allowlist) so new gpt-*/o-* chat models appear automatically;
    // we only need to exclude the known non-chat families.
    parseModels: (json) => {
      const skip =
        /embedding|whisper|tts|audio|realtime|moderation|dall-e|image|davinci|babbage|transcribe|search|codex-mini/i;
      return asRecords((json as { data?: unknown })?.data)
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter((id) => id.length > 0 && !skip.test(id));
    },
  },
};

// Stable insertion order for pickers and help text.
export const providerList: Provider[] = Object.values(providers);

export function isProviderId(value: string): value is ProviderId {
  return value in providers;
}

// Presence check only — the value never leaves process.env.
export function hasApiKey(provider: Provider): boolean {
  const value = process.env[provider.envVar];
  return typeof value === "string" && value.trim().length > 0;
}
