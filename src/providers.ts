// Security invariant: key VALUES flow through exactly one path — paste prompt →
// verifyApiKey → auth store. Everything else checks only *presence*
// (hasApiKey) and lets the SDKs read process.env themselves.

import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  getActiveChatGPT,
  chatgptHeaders,
  CHATGPT_BASE_URL,
} from "./oauth.ts";

export type ProviderId = "google" | "anthropic" | "openai" | "openai-chatgpt";


type BaseProvider = {
  id: ProviderId;
  label: string;
  // Adopted on switch — the previous provider's model id is meaningless here.
  defaultModel: string;
  resolve: (model: string) => LanguageModel;
};


export type ApiKeyProvider = BaseProvider & {
  auth: "api-key";
  // Read by the SDK itself; Bun auto-loads .env at startup.
  envVar: string;
  // One cheap GET serves double duty: verifying a pasted key and populating
  // the model list.
  verifyRequest: (key: string) => {
    url: string;
    headers: Record<string, string>;
  };
  // `json` is untrusted, so every access is defensive; [] on anything odd.
  parseModels: (json: unknown) => string[];
};

// OAuth rather than a pasted key. It has a live catalog too, just not the
// api.openai.com one, behind a short-lived bearer.
export type OAuthProvider = BaseProvider & {
  auth: "oauth";
  // Fallback when the live list can't be fetched, so the picker is never empty.
  models: string[];
  // Built at call time, not module load: the bearer is refreshed by auth.ts, so
  // a closure captured at startup would go stale. Null when there's no token.
  listRequest: () => { url: string; headers: Record<string, string> } | null;
  parseModels: (json: unknown) => string[];
  // model → effort → the provider's own wording. syd never writes these
  // itself; a provider that publishes nothing yields {}.
  parseReasoningDescriptions: (
    json: unknown,
  ) => Record<string, Record<string, string>>;
};

export type Provider = ApiKeyProvider | OAuthProvider;

// Narrows an untrusted value for defensive parsing.
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
    auth: "api-key",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    resolve: (model) => google(model),
    verifyRequest: (key) => ({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: { "x-goog-api-key": key },
    }),
    // generateContent is also advertised by tts/image/embedding variants, so
    // they have to be filtered back out.
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
    auth: "api-key",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5",
    resolve: (model) => anthropic(model),
    verifyRequest: (key) => ({
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    }),
    // Every entry is a chat model, so no filtering needed.
    parseModels: (json) =>
      asRecords((json as { data?: unknown })?.data)
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter((id) => id.length > 0),
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    auth: "api-key",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.1",
    resolve: (model) => openai(model),
    verifyRequest: (key) => ({
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${key}` },
    }),
    // The list mixes in embeddings/audio/image with no "is chat" flag. A
    // denylist, not an allowlist, so new chat models appear automatically.
    parseModels: (json) => {
      const skip =
        /embedding|whisper|tts|audio|realtime|moderation|dall-e|image|davinci|babbage|transcribe|search|codex-mini/i;
      return asRecords((json as { data?: unknown })?.data)
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter((id) => id.length > 0 && !skip.test(id));
    },
  },
  "openai-chatgpt": {
    id: "openai-chatgpt",
    label: "OpenAI (ChatGPT plan)",
    auth: "oauth",
    // Offline fallback only — the real set is account/plan-dependent and
    // fetched live below. The picker also accepts any typed id.
    defaultModel: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.4"],
    // `client_version` is required — omitting it is a 400, not a default — and
    // it gates which models come back. syd has no meaningful version to claim,
    // so it sends a floor value and filters on the response's own flags instead.
    //
    // Undocumented private API: it can change or vanish without notice, so every
    // consumer treats failure as "fall back to `models`", never as an error.
    listRequest: () => {
      const tok = getActiveChatGPT();
      if (!tok) return null;
      return {
        url: `${CHATGPT_BASE_URL}/models?client_version=0.0.0`,
        headers: {
          ...chatgptHeaders(tok.accountId),
          authorization: `Bearer ${tok.access}`,
        },
      };
    },
    // The backend's own flags drop internal entries like "codex-auto-review".
    // Order is preserved — it returns them by its own priority, which beats a
    // string sort, so unlike the key providers this is NOT re-sorted.
    parseModels: (json) =>
      asRecords((json as { models?: unknown })?.models)
        .filter(
          (m) => m.visibility === "list" && m.supported_in_api === true,
        )
        .map((m) => (typeof m.slug === "string" ? m.slug : ""))
        .filter((slug) => slug.length > 0),
    // A UI hint, not the API's validation set — the backend accepts
    // `reasoningEffort: "none"` though no model advertises a "none" tier, so
    // this must never gate what syd may send.
    parseReasoningDescriptions: (json) => {
      const out: Record<string, Record<string, string>> = {};
      for (const m of asRecords((json as { models?: unknown })?.models)) {
        if (typeof m.slug !== "string" || m.slug.length === 0) continue;
        const levels: Record<string, string> = {};
        for (const level of asRecords(m.supported_reasoning_levels)) {
          if (
            typeof level.effort === "string" &&
            typeof level.description === "string" &&
            level.description.length > 0
          ) {
            levels[level.effort] = level.description;
          }
        }
        if (Object.keys(levels).length > 0) out[m.slug] = levels;
      }
      return out;
    },
    // ensureProviderReady refreshes before the call, so the token read here is
    // fresh. `.responses` targets the API shape this backend speaks.
    resolve: (model) => {
      const tok = getActiveChatGPT();
      return createOpenAI({
        baseURL: CHATGPT_BASE_URL,
        apiKey: tok?.access ?? "",
        headers: chatgptHeaders(tok?.accountId ?? null),
      }).responses(model);
    },
  },
};

// Stable order for pickers and help text.
export const providerList: Provider[] = Object.values(providers);

export function isProviderId(value: string): value is ProviderId {
  return value in providers;
}

// Presence, not validity — the value never leaves process.env, and an expired
// OAuth token is handled at call time by refresh.
export function hasApiKey(provider: Provider): boolean {
  if (provider.auth === "oauth") return getActiveChatGPT() !== null;
  const value = process.env[provider.envVar];
  return typeof value === "string" && value.trim().length > 0;
}
