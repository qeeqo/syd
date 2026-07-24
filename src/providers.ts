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
  // Cheap authenticated GET (list-models) used to verify a pasted key
  // before it's stored. Costs nothing on all three providers.
  verifyRequest: (key: string) => {
    url: string;
    headers: Record<string, string>;
  };
};

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
