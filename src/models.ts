// Live model discovery — pure module, no React, no TUI.
//
// Each provider's list-models endpoint (the same one verifyApiKey pings) is
// fetched with the stored key and parsed into chat-model ids. Results are
// memoized per provider for the process lifetime: model catalogs change on
// the order of weeks, and one fetch per launch is plenty. Failures fail soft
// to an empty list — the user can always still type a model id directly.

import { providers, type Provider, type ProviderId } from "./providers";
import { ensureProviderReady } from "./auth";

// Newest-first ordering: numeric-aware compare, reversed, so "gpt-5" sorts
// above "gpt-4" and "gemini-3.5" above "gemini-2.0". Not perfect across every
// naming scheme, but it keeps current models near the top where they belong.
function byNewest(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

const cache = new Map<ProviderId, string[]>();

// Provider-authored reasoning-effort descriptions, keyed provider → model →
// effort. Filled from the same catalog response as `cache` (one fetch, two
// derived views) and read by the /thinking picker. A provider that publishes
// none — every key provider today — never gets an entry, and the picker then
// shows a bare list rather than wording syd made up.
const reasoningCache = new Map<
  ProviderId,
  Record<string, Record<string, string>>
>();

// The provider's own descriptions for `model`'s reasoning efforts, or an empty
// object when it publishes none. Synchronous and cache-only by design: the
// picker opens on a keystroke and must render immediately, and the catalog it
// reads was already fetched by the model list. Nothing here triggers a request.
export function reasoningDescriptions(
  id: ProviderId,
  model: string,
): Record<string, string> {
  return reasoningCache.get(id)?.[model] ?? {};
}

export type FetchModelsResult =
  | { ok: true; models: string[] }
  // "no-key": the provider has no key in env, so there's nothing to ask.
  // "unreachable": network/HTTP failure. "empty": the endpoint answered but
  // parsed to nothing (shape drift). All three leave the picker usable via
  // manual entry; the UI shows a matching hint.
  | { ok: false; reason: "no-key" | "unreachable" | "empty" };

async function load(provider: Provider): Promise<FetchModelsResult> {
  // OAuth providers do have a live catalog, it just isn't the key providers'
  // endpoint and its bearer expires. Refresh first so listRequest reads a valid
  // token, then fall back to the baked-in list on any failure — an offline or
  // shape-drifted response should leave the picker usable, not empty.
  //
  // Deliberately NOT sorted by byNewest: the backend returns its own priority
  // order (newest/most-capable first), which is better than a string compare.
  if (provider.auth === "oauth") {
    const fallback: FetchModelsResult =
      provider.models.length > 0
        ? { ok: true, models: provider.models }
        : { ok: false, reason: "empty" };
    try {
      await ensureProviderReady(provider.id);
      const req = provider.listRequest();
      if (!req) return fallback;
      const res = await fetch(req.url, {
        headers: req.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return fallback;
      // One response, two derived views: the ids for the picker list and the
      // per-model effort descriptions for the /thinking picker. Parsed together
      // so the two can never disagree about which catalog they came from.
      const body: unknown = await res.json();
      const models = provider.parseModels(body);
      if (models.length === 0) return fallback;
      reasoningCache.set(provider.id, provider.parseReasoningDescriptions(body));
      return { ok: true, models };
    } catch {
      return fallback;
    }
  }

  const key = process.env[provider.envVar];
  if (!key || !key.trim()) return { ok: false, reason: "no-key" };

  try {
    const { url, headers } = provider.verifyRequest(key);
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const models = provider.parseModels(await res.json()).sort(byNewest);
    if (models.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, models };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

// Fetch (or return cached) chat models for a provider. `refresh` bypasses the
// cache for an explicit re-pull.
export async function fetchModels(
  id: ProviderId,
  refresh = false,
): Promise<FetchModelsResult> {
  if (!refresh) {
    const cached = cache.get(id);
    if (cached) return { ok: true, models: cached };
  }
  const result = await load(providers[id]);
  if (result.ok) cache.set(id, result.models);
  return result;
}

// Fire-and-forget warm-up, used right after a key is saved so the picker is
// instant on first open. Never throws; a failure just leaves the cache empty.
export function primeModels(id: ProviderId): void {
  void fetchModels(id, true).catch(() => {});
}
