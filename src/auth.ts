// API key storage — pure module, no React, no TUI.
//
// Keys live in ~/.sydcli/auth.json, or in real env vars (shell / .env) which
// always take precedence. At startup applyStoredKeys() surfaces stored keys
// into process.env, so the AI SDKs keep reading keys the way they always
// have — no key value ever flows through app code after that point.
//
// Security invariants:
//   - auth.json is chmod 600 (owner read/write only); ~/.sydcli is 700.
//   - Written atomically (tmp + rename), and the tmp file is locked down
//     BEFORE it becomes the real file — no window where keys are readable.
//   - Key values are never logged, rendered, or included in errors.

import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, mkdir, rename } from "node:fs/promises";
import {
  providers,
  providerList,
  type Provider,
  type ProviderId,
} from "./providers.ts";
import {
  refreshChatGPTTokens,
  setActiveChatGPT,
  type ChatGPTTokens,
} from "./oauth.ts";

const AUTH_DIR = join(homedir(), ".sydcli");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

// Reserved store key holding the ChatGPT OAuth tokens as a JSON blob. Kept out
// of the env-var namespace so it never collides with a provider's key and is
// never surfaced into process.env.
const CHATGPT_STORE_KEY = "openai-chatgpt-tokens";

// Sanity-check a pasted key: printable ASCII only (no whitespace, no control
// chars from paste artifacts), sane length. Provider key formats vary too
// much to validate harder without false rejections. Returns the trimmed key,
// or null if it can't be one.
export function validateApiKey(raw: string): string | null {
  const key = raw.trim();
  if (key.length < 8 || key.length > 512) return null;
  if (!/^[\x21-\x7e]+$/.test(key)) return null;
  return key;
}

// Live check against the provider's API before a key is stored.
//   "ok"          → authenticated successfully
//   "invalid"     → the provider rejected the key (400/401/403)
//   "unreachable" → network failure, timeout, or a 5xx/429 — the key can't
//                   be judged either way, so don't store it; let the user retry.
export type KeyVerdict = "ok" | "invalid" | "unreachable";

export async function verifyApiKey(
  provider: Provider,
  key: string,
): Promise<KeyVerdict> {
  // OAuth providers don't authenticate by pasted key; nothing to verify.
  if (provider.auth !== "api-key") return "invalid";
  const { url, headers } = provider.verifyRequest(key);
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "ok";
    // Google reports a bad key as 400; Anthropic/OpenAI use 401/403.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return "invalid";
    }
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const data: unknown = await Bun.file(AUTH_FILE).json();
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return {};
    }
    // Keep only string values — anything else is a corrupt/tampered entry.
    const store: Record<string, string> = {};
    for (const [envVar, value] of Object.entries(data)) {
      if (typeof value === "string") store[envVar] = value;
    }
    return store;
  } catch {
    return {};
  }
}

// Atomic, owner-only write of the whole store. The tmp file is locked down
// BEFORE it becomes the real file, so there's no window where secrets are
// world-readable. Shared by every writer so the invariants live in one place.
async function writeStore(store: Record<string, string>): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${AUTH_FILE}.tmp`;
  await Bun.write(tmp, JSON.stringify(store, null, 2));
  await chmod(tmp, 0o600);
  await rename(tmp, AUTH_FILE);
}

export async function saveApiKey(envVar: string, key: string): Promise<void> {
  const store = await readStore();
  store[envVar] = key;
  await writeStore(store);
  // Make it live for this process immediately — the SDKs read process.env.
  process.env[envVar] = key;
}

// --- ChatGPT OAuth tokens ---------------------------------------------------

// Read the stored tokens, defensively (the file is user-editable and could be
// corrupt). Returns null if absent or unusable.
async function loadChatGPTTokens(): Promise<ChatGPTTokens | null> {
  const raw = (await readStore())[CHATGPT_STORE_KEY];
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<ChatGPTTokens>;
    if (
      typeof t.access === "string" &&
      typeof t.refresh === "string" &&
      typeof t.expiresAt === "number"
    ) {
      return {
        access: t.access,
        refresh: t.refresh,
        accountId: typeof t.accountId === "string" ? t.accountId : null,
        expiresAt: t.expiresAt,
      };
    }
  } catch {
    // Corrupt entry → treat as signed out.
  }
  return null;
}

// Persist tokens and make them live for this process (the resolve holder).
export async function saveChatGPTTokens(tokens: ChatGPTTokens): Promise<void> {
  const store = await readStore();
  store[CHATGPT_STORE_KEY] = JSON.stringify(tokens);
  await writeStore(store);
  setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
}

// Return a usable access token, refreshing first if it's at/near expiry.
// Refresh responses can drop the account-id claim, so the previous account id
// is carried forward. Throws if not signed in or the refresh fails — the
// caller surfaces that and can re-run the login.
export async function getChatGPTAccessToken(): Promise<{
  access: string;
  accountId: string | null;
}> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) throw new Error("not signed in to ChatGPT — run /provider");

  // Refresh a minute early so an in-flight call never races the expiry.
  if (Date.now() < tokens.expiresAt - 60_000) {
    setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
    return { access: tokens.access, accountId: tokens.accountId };
  }

  const refreshed = await refreshChatGPTTokens(tokens.refresh);
  if (!refreshed.accountId) refreshed.accountId = tokens.accountId;
  await saveChatGPTTokens(refreshed);
  return { access: refreshed.access, accountId: refreshed.accountId };
}

// Generic pre-call hook used by chat.ts: make sure the provider's credentials
// are ready to use. No-op for key providers (the SDK reads env); for OAuth it
// refreshes the token if needed and updates the resolve holder.
export async function ensureProviderReady(id: ProviderId): Promise<void> {
  if (providers[id].auth === "oauth") await getChatGPTAccessToken();
}

// Startup: load stored keys into this process's env. A real env var
// (shell export or .env) always wins over the store.
export async function applyStoredKeys(): Promise<void> {
  const store = await readStore();
  for (const provider of providerList) {
    if (provider.auth !== "api-key") continue;
    if (!process.env[provider.envVar] && store[provider.envVar]) {
      process.env[provider.envVar] = store[provider.envVar];
    }
  }
  // Prime the ChatGPT resolve holder so hasApiKey() reports it as ready and
  // the first call has a token to refresh from. No network here — refresh is
  // deferred to the first actual use (getChatGPTAccessToken).
  const tokens = await loadChatGPTTokens();
  if (tokens) {
    setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
  }
}
