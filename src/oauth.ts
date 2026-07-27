// ChatGPT (Codex) OAuth — pure module, no React, no TUI.
//
// Lets a user authenticate syd with their ChatGPT account instead of a pasted
// API key, so model calls ride the account's Codex quota rather than paid API
// credits. This reuses OpenAI's *own* Codex CLI OAuth client (a public client
// ID, no secret) with an Authorization-Code + PKCE loopback flow — the same
// pattern behind `gh auth login`. It is unofficial: syd talks to the
// non-public chatgpt.com/backend-api, so OpenAI can change or restrict it at
// any time. Each user authenticates their OWN account; tokens never leave the
// user's machine (see auth.ts for the on-disk store's 0600 guarantees).
//
// Security invariants (mirror auth.ts / providers.ts):
//   - Token VALUES (access/refresh/id) are never logged, rendered, or put in
//     error messages. Only presence/expiry is inspected by app code.
//   - `state` is validated on the callback; PKCE `code_verifier` never leaves
//     this process. The loopback server binds localhost only and lives just
//     long enough to catch the one redirect.

// OpenAI's public Codex CLI OAuth client. Not a secret (PKCE protects the
// exchange); it only whitelists the fixed loopback redirect below.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;

// The redirect URI is fixed: OpenAI's client only accepts this exact loopback
// URL, so the port cannot be changed to dodge a conflict — if 1455 is taken,
// the login must wait for the other process to release it.
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const CALLBACK_PATH = "/auth/callback";

const SCOPE = "openid profile email offline_access";
// Codex CLI identifies itself with this originator; the backend expects it on
// both the authorize request and later model calls (see chatgptHeaders).
const ORIGINATOR = "codex_cli_rs";

// The base URL and beta header the AI SDK's OpenAI provider must be pointed at
// to reach the ChatGPT-plan backend instead of api.openai.com. Exported so
// providers.ts builds the model without duplicating these constants.
export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

// Tokens as syd stores and consumes them. `accountId` comes from the id_token
// and is required as a header on every backend call; `expiresAt` is epoch ms,
// used to refresh proactively before a call would 401.
export type ChatGPTTokens = {
  access: string;
  refresh: string;
  accountId: string | null;
  expiresAt: number;
};

// --- Active token holder ----------------------------------------------------
//
// providers.ts's oauth `resolve` is synchronous (the AI SDK reads a plain
// string apiKey), but the live access token changes as it refreshes. auth.ts
// keeps this holder current (on startup, after login, and after each refresh);
// resolve reads it at call time. Only the access token and account id live
// here — never the refresh token, which stays in the on-disk store.

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

// --- PKCE + small encoding helpers -----------------------------------------

// base64url without padding — the encoding PKCE and JWT both use.
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

// Pull chatgpt_account_id out of the id_token. The claim lives under the
// namespaced "https://api.openai.com/auth" object; JWTs are untrusted input
// here (we only decode, never verify — the token endpoint is the trust
// anchor), so every access is defensive and any surprise yields null.
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
    // Malformed token → treat as no account id; the caller decides.
  }
  return null;
}

// Shape of the /oauth/token response we rely on. Unknown fields are ignored;
// missing expected fields are handled by the parser below.
type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
};

// Turn a raw token response into ChatGPTTokens, carrying the previous refresh
// token forward when a refresh response omits a new one (the endpoint may not
// rotate it). Throws a value-free error if the response is unusable.
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
  // Default to a conservative 1h lifetime if the server omits expires_in.
  const ttlSeconds =
    typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    access,
    refresh,
    accountId: accountIdFromIdToken(idToken),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

// --- The interactive login flow --------------------------------------------

export type LoginHandle = {
  // The authorize URL to open in the user's browser.
  url: string;
  // Resolves with tokens once the browser redirect is caught and exchanged,
  // or rejects on timeout / mismatched state / exchange failure. Awaiting this
  // also tears down the loopback server.
  result: Promise<ChatGPTTokens>;
};

// Begin a login: spin up the loopback server, build the authorize URL, and
// hand both back. The caller opens `url` (see openUrl) and awaits `result`.
// The server auto-closes on success, error, or `timeoutMs`.
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

  // Resolver plumbing: the HTTP handler (below) settles this promise, and the
  // finally-block stops the server exactly once regardless of how it settles.
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
      // The provider reports login errors via ?error=...; surface a value-free
      // message and close the loop.
      const err = url.searchParams.get("error");
      if (err) {
        // Surface the provider's error_description (RFC 6749 §4.1.2.1), not just
        // the bare code, so a failure explains itself instead of "access_denied".
        const desc = url.searchParams.get("error_description");
        fail(new Error(`authorization failed: ${desc ? `${err} — ${desc}` : err}`));
        return callbackPage("Login failed. You can close this tab.");
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      // CSRF guard: a callback whose state doesn't match ours is rejected.
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

  // Whatever happens, release the port and the timer once.
  const done = result.finally(() => {
    clearTimeout(timer);
    // Graceful stop (not stop(true)): the callback page is still flushing to
    // the browser when this runs, and closing active connections would reset
    // that write, showing a browser error despite a successful login. Let the
    // in-flight response finish before releasing the port.
    server.stop();
  });

  return { url: authorize.toString(), result: done };
}

// Exchange the one-time authorization code for tokens (PKCE proves we started
// the flow). Standard OAuth form-encoded body.
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

// Trade a refresh token for a fresh access token. Called by auth.ts when a
// stored access token is at/near expiry. The refresh token is reused if the
// server doesn't return a new one.
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

// Post-login health check: exercise one real (tiny) call against the backend
// with `model`, so a rejected model id or a non-working account surfaces
// immediately instead of on the user's first prompt. Reads the active token
// (set by saveChatGPTTokens). Returns null when the call succeeds, or a short
// human-readable reason otherwise — never a token value.
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
        // probe must stream. We only need the status line — the 200 confirms
        // the model is accepted — so the body is cancelled without reading.
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

// Extra headers the ChatGPT backend requires on every model call, beyond the
// Bearer token the AI SDK sends. `session_id` is a fresh uuid per call.
export function chatgptHeaders(accountId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "OpenAI-Beta": "responses=experimental",
    originator: ORIGINATOR,
    session_id: crypto.randomUUID(),
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return headers;
}

// Open a URL in the user's default browser. Best-effort: on failure the caller
// still shows the URL for the user to open manually.
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
    // Ignore — the UI prints the URL as a fallback.
  }
}

// The tiny HTML page shown in the browser tab after the redirect.
function callbackPage(message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:3rem;text-align:center">` +
      `<h2>${message}</h2></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
