// Cache slow-moving catalogs per process; failures leave manual entry available.

import { providers, type Provider, type ProviderId } from "./providers";
import { ensureProviderReady } from "./auth";

// Reverse numeric sorting is only a heuristic across provider naming schemes.
function byNewest(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

const cache = new Map<ProviderId, string[]>();

const reasoningCache = new Map<
  ProviderId,
  Record<string, Record<string, string>>
>();

// Cache-only so opening the picker never starts network work.
export function reasoningDescriptions(
  id: ProviderId,
  model: string,
): Record<string, string> {
  return reasoningCache.get(id)?.[model] ?? {};
}

export type FetchModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: "no-key" | "unreachable" | "empty" };

async function load(provider: Provider): Promise<FetchModelsResult> {
  // Refresh before building the token-bound request; preserve backend priority order.
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
