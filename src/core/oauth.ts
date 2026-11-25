// Unofficial ChatGPT integration using Codex CLI's public PKCE client and
// private backend; OpenAI may change or restrict it without notice.

// Public client — PKCE protects the exchange, and it only whitelists the fixed
// loopback redirect below.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;

// OpenAI whitelists this exact loopback URI, so port conflicts cannot fall back.
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const CALLBACK_PATH = "/auth/callback";

const SCOPE = "openid profile email offline_access";
// The backend expects this originator on both the authorize request and later
// model calls.
const ORIGINATOR = "codex_cli_rs";

export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

// Backend calls require the account ID as a header.
export type ChatGPTTokens = {
  access: string;
  refresh: string;
  accountId: string | null;
  expiresAt: number;
};

// resolve() is synchronous, so it reads the refreshable access token from this
// process-local holder; refresh tokens remain on disk.

let active: { access: string; accountId: string | null } | null = null;

export function setActiveChatGPT(
  value: { access: string; accountId: string | null } | null,
): void {
  active = value;
}

export function getActiveChatGPT(): {
  access: string;
  accountId: string | null;
} | null {
  return active;
}

// base64url without padding — what PKCE and JWT both use.
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return new Uint8Array(digest);
}

// Decode only to extract the namespaced account claim; trust comes from the
// token endpoint, and malformed or unexpected JWTs yield null.
function accountIdFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    const auth = json["https://api.openai.com/auth"];
    if (typeof auth === "object" && auth !== null) {
      const id = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // Malformed token → no account id; the caller decides.
  }
  return null;
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
};

// Preserve the previous refresh token when the endpoint does not rotate it.
function toTokens(
  body: TokenResponse,
  prevRefresh?: string,
): ChatGPTTokens {
  const access = typeof body.access_token === "string" ? body.access_token : "";
  if (!access) throw new Error("token response missing access_token");
  const refresh =
    typeof body.refresh_token === "string" ? body.refresh_token : prevRefresh;
  if (!refresh) throw new Error("token response missing refresh_token");
  const idToken =
    typeof body.id_token === "string" ? body.id_token : undefined;
  // Conservative 1h default if the server omits expires_in.
  const ttlSeconds =
    typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    access,
    refresh,
    accountId: accountIdFromIdToken(idToken),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

export type LoginHandle = {
  url: string;
  result: Promise<ChatGPTTokens>;
};

// Settlement of result always tears down the loopback server.
export async function startChatGPTLogin(
  timeoutMs = 300_000,
): Promise<LoginHandle> {
  const state = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = base64url(await sha256(codeVerifier));

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("scope", SCOPE);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("id_token_add_organizations", "true");
  authorize.searchParams.set("codex_cli_simplified_flow", "true");
  authorize.searchParams.set("originator", ORIGINATOR);
  authorize.searchParams.set("state", state);

  let settle!: (value: ChatGPTTokens) => void;
  let fail!: (err: Error) => void;
  const result = new Promise<ChatGPTTokens>((res, rej) => {
    settle = res;
    fail = rej;
  });

  const server = Bun.serve({
    port: REDIRECT_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response("Not found", { status: 404 });
      }
      const err = url.searchParams.get("error");
      if (err) {
        // RFC 6749 §4.1.2.1 — the bare code alone doesn't explain the failure.
        const desc = url.searchParams.get("error_description");
        fail(new Error(`authorization failed: ${desc ? `${err} — ${desc}` : err}`));
        return callbackPage("Login failed. You can close this tab.");
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      // CSRF guard.
      if (!code || returnedState !== state) {
        fail(new Error("authorization response failed validation"));
        return callbackPage("Login could not be verified. You can close this tab.");
      }
      try {
        settle(await exchangeCode(code, codeVerifier));
        return callbackPage("Signed in to syd. You can close this tab.");
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
        return callbackPage("Sign-in failed. You can close this tab.");
      }
    },
  });

  const timer = setTimeout(
    () => fail(new Error("login timed out — no response from the browser")),
    timeoutMs,
  );

  const done = result.finally(() => {
    clearTimeout(timer);
    // Do not force-close while the browser may still be receiving the result page.
    server.stop();
  });

  return { url: authorize.toString(), result: done };
}

// The verifier binds an intercepted code to this login attempt.
async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<ChatGPTTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Body may echo the code; never surface it — status only.
    throw new Error(`token exchange failed (${res.status})`);
  }
  return toTokens((await res.json()) as TokenResponse);
}

export async function refreshChatGPTTokens(
  refresh: string,
): Promise<ChatGPTTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
      scope: "openid profile email",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`token refresh failed (${res.status})`);
  return toTokens((await res.json()) as TokenResponse, refresh);
}

// Probe now so account/model rejection surfaces before the first real prompt;
// never return token data.
export async function verifyChatGPTAccess(model: string): Promise<string | null> {
  const tok = getActiveChatGPT();
  if (!tok) return "not signed in";
  try {
    const res = await fetch(`${CHATGPT_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.access}`,
        "content-type": "application/json",
        ...chatgptHeaders(tok.accountId),
      },
      body: JSON.stringify({
        model,
        instructions: "Health check.",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "ok" }] },
        ],
        // The backend rejects both stream:false and store:true, so a valid
        // probe must stream. The 200 is all we need, so the body is cancelled
        // without reading.
        stream: true,
        store: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      await res.body?.cancel();
      return null;
    }
    // The backend puts the reason in `detail` (400s) or `error.message`.
    let reason = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        detail?: unknown;
        error?: { message?: unknown };
      };
      if (typeof body.detail === "string") reason = body.detail;
      else if (typeof body.error?.message === "string") reason = body.error.message;
    } catch {
      // Non-JSON error body — keep the status code.
    }
    return reason;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function chatgptHeaders(accountId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "OpenAI-Beta": "responses=experimental",
    originator: ORIGINATOR,
    session_id: crypto.randomUUID(),
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return headers;
}

// Best-effort: on failure the caller still shows the URL to open manually.
export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    return undefined;
  }
}

function callbackPage(message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:3rem;text-align:center">` +
      `<h2>${message}</h2></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
