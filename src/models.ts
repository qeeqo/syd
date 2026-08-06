// Memoized per provider for the process lifetime: catalogs change on the order
// of weeks. Failures fail soft — the user can always type a model id directly.

import { providers, type Provider, type ProviderId } from "./providers";
import { ensureProviderReady } from "./auth";

// Numeric-aware and reversed, so "gpt-5" sorts above "gpt-4". Imperfect across
// naming schemes, but it keeps current models near the top.
function byNewest(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

const cache = new Map<ProviderId, string[]>();

// provider → model → effort, filled from the same response as `cache`. A
// provider that publishes none never gets an entry, and the picker then shows a
// bare list rather than wording syd made up.
const reasoningCache = new Map<
  ProviderId,
  Record<string, Record<string, string>>
>();

// Cache-only by design: the picker opens on a keystroke and must render
// immediately, so nothing here triggers a request.
export function reasoningDescriptions(
  id: ProviderId,
  model: string,
): Record<string, string> {
  return reasoningCache.get(id)?.[model] ?? {};
}

export type FetchModelsResult =
  | { ok: true; models: string[] }
  // All three still leave the picker usable via manual entry.
  | { ok: false; reason: "no-key" | "unreachable" | "empty" };

async function load(provider: Provider): Promise<FetchModelsResult> {
  // Refresh first so listRequest reads a valid token, then fall back to the
  // baked-in list on any failure. Deliberately NOT sorted by byNewest — the
  // backend returns its own priority order, which beats a string compare.
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
      // Both views come from one response, so they can never disagree about
      // which catalog they came from.
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

// Never throws; a failure just leaves the cache empty.
export function primeModels(id: ProviderId): void {
  void fetchModels(id, true).catch(() => {});
}
