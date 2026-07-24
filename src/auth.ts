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
import { providerList, type Provider } from "./providers.ts";

const AUTH_DIR = join(homedir(), ".sydcli");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

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

export async function saveApiKey(envVar: string, key: string): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  const store = await readStore();
  store[envVar] = key;

  const tmp = `${AUTH_FILE}.tmp`;
  await Bun.write(tmp, JSON.stringify(store, null, 2));
  await chmod(tmp, 0o600);
  await rename(tmp, AUTH_FILE);

  // Make it live for this process immediately — the SDKs read process.env.
  process.env[envVar] = key;
}

// Startup: load stored keys into this process's env. A real env var
// (shell export or .env) always wins over the store.
export async function applyStoredKeys(): Promise<void> {
  const store = await readStore();
  for (const provider of providerList) {
    if (!process.env[provider.envVar] && store[provider.envVar]) {
      process.env[provider.envVar] = store[provider.envVar];
    }
  }
}
