// Live model discovery — pure module, no React, no TUI.
//
// Each provider's list-models endpoint (the same one verifyApiKey pings) is
// fetched with the stored key and parsed into chat-model ids. Results are
// memoized per provider for the process lifetime: model catalogs change on
// the order of weeks, and one fetch per launch is plenty. Failures fail soft
// to an empty list — the user can always still type a model id directly.

import { providers, type Provider, type ProviderId } from "./providers";

// Newest-first ordering: numeric-aware compare, reversed, so "gpt-5" sorts
// above "gpt-4" and "gemini-3.5" above "gemini-2.0". Not perfect across every
// naming scheme, but it keeps current models near the top where they belong.
function byNewest(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

const cache = new Map<ProviderId, string[]>();

export type FetchModelsResult =
  | { ok: true; models: string[] }
  // "no-key": the provider has no key in env, so there's nothing to ask.
  // "unreachable": network/HTTP failure. "empty": the endpoint answered but
  // parsed to nothing (shape drift). All three leave the picker usable via
  // manual entry; the UI shows a matching hint.
  | { ok: false; reason: "no-key" | "unreachable" | "empty" };

async function load(provider: Provider): Promise<FetchModelsResult> {
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
