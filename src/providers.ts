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
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  getActiveChatGPT,
  chatgptHeaders,
  CHATGPT_BASE_URL,
} from "./oauth.ts";

export type ProviderId = "google" | "anthropic" | "openai" | "openai-chatgpt";

// Fields common to every provider, regardless of how it authenticates.
type BaseProvider = {
  id: ProviderId;
  label: string;
  // Model adopted when the user switches TO this provider — the previous
  // provider's model id would be meaningless here.
  defaultModel: string;
  resolve: (model: string) => LanguageModel;
};

// A provider authenticated by a pasted API key (Google, Anthropic, OpenAI).
export type ApiKeyProvider = BaseProvider & {
  auth: "api-key";
  // Env var the SDK reads the key from (Bun auto-loads .env at startup).
  envVar: string;
  // Cheap authenticated GET (list-models) used both to verify a pasted key
  // before it's stored AND to populate the live model list. Costs nothing on
  // all three key-based providers.
  verifyRequest: (key: string) => {
    url: string;
    headers: Record<string, string>;
  };
  // Parse the list-models response body into chat-capable model ids. Each
  // provider returns a different shape; `json` is untrusted (unknown), so
  // every access is defensive. Returns [] on anything unexpected.
  parseModels: (json: unknown) => string[];
};

// A provider authenticated by ChatGPT OAuth (see oauth.ts). No key to paste,
// but it does have a live catalog endpoint — it just isn't the api.openai.com
// one, and its bearer is a short-lived OAuth token rather than a static key.
export type OAuthProvider = BaseProvider & {
  auth: "oauth";
  // Offline/fallback catalog, used when the live list can't be fetched (no
  // token yet, no network, or the endpoint changing shape under us). Keeps the
  // picker usable rather than empty; it just won't know about newer models.
  models: string[];
  // Built at call time, not once at module load: the bearer is an access token
  // that auth.ts refreshes, so capturing it in a closure at startup would go
  // stale. Returns null when there is no active token to authenticate with.
  listRequest: () => { url: string; headers: Record<string, string> } | null;
  parseModels: (json: unknown) => string[];
  // Per-model reasoning-effort descriptions, pulled from the same catalog
  // response. Keyed model → effort → the provider's own wording. syd never
  // writes these itself; a provider that publishes nothing simply yields {}.
  parseReasoningDescriptions: (
    json: unknown,
  ) => Record<string, Record<string, string>>;
};

export type Provider = ApiKeyProvider | OAuthProvider;

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
    auth: "api-key",
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
    auth: "api-key",
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
    auth: "api-key",
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
  "openai-chatgpt": {
    id: "openai-chatgpt",
    label: "OpenAI (ChatGPT plan)",
    auth: "oauth",
    // ChatGPT accounts accept only a narrow allow-list on the Codex backend —
    // NOT the api.openai.com catalog and NOT the gpt-*-codex ids. The set is
    // account/plan-dependent and shifts over time, which is exactly why it is
    // fetched live (listRequest below) instead of frozen here. This list is
    // only the offline fallback; the picker also allows typing any id, and a
    // rejected one surfaces the backend's message instead of failing silently.
    defaultModel: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.4"],
    // The Codex backend's own catalog. `client_version` is required — omitting
    // it is a 400, not a default — and it gates which models come back via each
    // entry's `minimal_client_version`. syd is not the Codex CLI and has no
    // meaningful version to claim here, so it sends a floor value and filters on
    // the response's own `visibility` / `supported_in_api` flags instead.
    //
    // Undocumented private API: it can change or disappear without notice, so
    // every consumer of this treats a failure as "fall back to `models`", never
    // as an error worth interrupting the user over.
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
    // { models: [{ slug, visibility, supported_in_api, … }] }. Keep only what
    // the backend itself marks as user-listable and API-callable: that drops
    // internal entries like "codex-auto-review" and the "-wm" variants. Order is
    // preserved (the backend returns them by its own `priority`), so unlike the
    // key providers this list is deliberately NOT re-sorted.
    parseModels: (json) =>
      asRecords((json as { models?: unknown })?.models)
        .filter(
          (m) => m.visibility === "list" && m.supported_in_api === true,
        )
        .map((m) => (typeof m.slug === "string" ? m.slug : ""))
        .filter((slug) => slug.length > 0),
    // Each entry carries `supported_reasoning_levels: [{ effort, description }]`
    // — the backend's own words for what each effort does on that specific
    // model. Note this list is a UI hint, not the API's validation set: the
    // backend accepts `reasoningEffort: "none"` even though no model advertises
    // a "none" tier, so it must not be used to gate what syd may send.
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
    // Point the OpenAI SDK at the ChatGPT backend with the OAuth access token
    // as the bearer and the extra headers the backend requires. getActiveChatGPT
    // is kept current by auth.ts; ensureProviderReady refreshes it before the
    // call, so the token read here is fresh. `.responses` targets the Responses
    // API shape the backend speaks.
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

// Stable insertion order for pickers and help text.
export const providerList: Provider[] = Object.values(providers);

export function isProviderId(value: string): value is ProviderId {
  return value in providers;
}

// Presence check only — is this provider ready to use without prompting for
// credentials? For key providers, the env var is set (value never leaves
// process.env); for OAuth, tokens have been loaded/logged-in (validity is a
// separate concern handled at call time by refresh).
export function hasApiKey(provider: Provider): boolean {
  if (provider.auth === "oauth") return getActiveChatGPT() !== null;
  const value = process.env[provider.envVar];
  return typeof value === "string" && value.trim().length > 0;
}
