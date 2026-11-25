// Secret values must never be surfaced in logs, UI, or errors.

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

// Kept out of the env-var namespace so it never collides with a provider key
// and is never surfaced into process.env.
const CHATGPT_STORE_KEY = "openai-chatgpt-tokens";

// Printable ASCII and a sane length is as far as this can go — provider key
// formats vary too much to validate harder without false rejections.
export function validateApiKey(raw: string): string | null {
  const key = raw.trim();
  if (key.length < 8 || key.length > 512) return null;
  if (!/^[\x21-\x7e]+$/.test(key)) return null;
  return key;
}

// "unreachable" means the key can't be judged either way, so it isn't stored
// and the user retries.
export type KeyVerdict = "ok" | "invalid" | "unreachable";

export async function verifyApiKey(
  provider: Provider,
  key: string,
): Promise<KeyVerdict> {
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
    const store: Record<string, string> = {};
    for (const [envVar, value] of Object.entries(data)) {
      if (typeof value === "string") store[envVar] = value;
    }
    return store;
  } catch {
    return {};
  }
}

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
  // The SDKs read process.env, so make it live immediately.
  process.env[envVar] = key;
}

// Blob keys stay out of process.env so they cannot leak to child processes.

export async function readAuthBlob(key: string): Promise<string | undefined> {
  return (await readStore())[key];
}

export async function writeAuthBlob(key: string, value: string): Promise<void> {
  const store = await readStore();
  store[key] = value;
  await writeStore(store);
}

export async function deleteAuthBlob(key: string): Promise<void> {
  const store = await readStore();
  if (key in store) {
    delete store[key];
    await writeStore(store);
  }
}

// Malformed user-edited token data fails closed as signed out.
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
    return null;
  }
  return null;
}

export async function saveChatGPTTokens(tokens: ChatGPTTokens): Promise<void> {
  const store = await readStore();
  store[CHATGPT_STORE_KEY] = JSON.stringify(tokens);
  await writeStore(store);
  setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
}

// Refresh responses may omit account ID, so preserve the previous claim.
export async function getChatGPTAccessToken(): Promise<{
  access: string;
  accountId: string | null;
}> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) throw new Error("not signed in to ChatGPT — run /provider");

  // A minute early, so an in-flight call never races the expiry.
  if (Date.now() < tokens.expiresAt - 60_000) {
    setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
    return { access: tokens.access, accountId: tokens.accountId };
  }

  const refreshed = await refreshChatGPTTokens(tokens.refresh);
  if (!refreshed.accountId) refreshed.accountId = tokens.accountId;
  await saveChatGPTTokens(refreshed);
  return { access: refreshed.access, accountId: refreshed.accountId };
}

export async function ensureProviderReady(id: ProviderId): Promise<void> {
  if (providers[id].auth === "oauth") await getChatGPTAccessToken();
}

// A real env var (shell export or .env) always wins over the store.
export async function applyStoredKeys(): Promise<void> {
  const store = await readStore();
  for (const provider of providerList) {
    if (provider.auth !== "api-key") continue;
    if (!process.env[provider.envVar] && store[provider.envVar]) {
      process.env[provider.envVar] = store[provider.envVar];
    }
  }
  // Defer network refresh until first use to keep startup offline.
  const tokens = await loadChatGPTTokens();
  if (tokens) {
    setActiveChatGPT({ access: tokens.access, accountId: tokens.accountId });
  }
}
