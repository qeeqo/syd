// The SDK owns discovery, dynamic registration, and PKCE; this module supplies
// persisted credentials, browser launch, and a localhost callback.

import {
  auth,
  type OAuthClientProvider,
  type OAuthTokens,
  type OAuthClientInformation,
  type OAuthClientMetadata,
} from "@ai-sdk/mcp";
import { readAuthBlob, writeAuthBlob, deleteAuthBlob } from "./auth";
import { openUrl } from "./oauth";

// Distinct from oauth.ts's ChatGPT loopback (1455) so the two never collide.
const REDIRECT_PORT = 1456;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const CALLBACK_PATH = "/callback";

function blobKey(server: string, kind: "tokens" | "client" | "verifier") {
  return `mcp-oauth:${server}:${kind}`;
}

// redirectToAuthorization is injected so the same storage serves both the
// silent-startup and interactive-login providers.
class McpOAuthProvider implements OAuthClientProvider {
  private readonly server: string;
  private readonly onRedirect: (url: URL) => void;

  constructor(server: string, onRedirect: (url: URL) => void) {
    this.server = server;
    this.onRedirect = onRedirect;
  }

  get redirectUrl(): string {
    return REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "sydcli",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Public client (no secret): PKCE protects the exchange.
      token_endpoint_auth_method: "none",
    };
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return parseBlob<OAuthTokens>(await readAuthBlob(blobKey(this.server, "tokens")));
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await writeAuthBlob(blobKey(this.server, "tokens"), JSON.stringify(tokens));
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return parseBlob<OAuthClientInformation>(
      await readAuthBlob(blobKey(this.server, "client")),
    );
  }

  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    await writeAuthBlob(blobKey(this.server, "client"), JSON.stringify(info));
  }

  async codeVerifier(): Promise<string> {
    const v = await readAuthBlob(blobKey(this.server, "verifier"));
    if (!v) throw new Error("no PKCE code verifier stored");
    return v;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await writeAuthBlob(blobKey(this.server, "verifier"), verifier);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.onRedirect(authorizationUrl);
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    if (scope === "all" || scope === "tokens") {
      await deleteAuthBlob(blobKey(this.server, "tokens"));
    }
    if (scope === "all" || scope === "client") {
      await deleteAuthBlob(blobKey(this.server, "client"));
    }
    if (scope === "all" || scope === "verifier") {
      await deleteAuthBlob(blobKey(this.server, "verifier"));
    }
  }
}

// Malformed JSON reads as absent so the SDK can restart login.
function parseBlob<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// Startup must not launch a browser before the TUI exists.
export function startupAuthProvider(server: string): OAuthClientProvider {
  return new McpOAuthProvider(server, () => {
    throw new Error("authorization required — run /mcp login " + server);
  });
}

export async function hasMcpTokens(server: string): Promise<boolean> {
  return (await readAuthBlob(blobKey(server, "tokens"))) !== undefined;
}

export async function loginMcpServer(
  server: string,
  serverUrl: string,
  onAuthorizeUrl?: (url: string) => void,
  timeoutMs = 300_000,
): Promise<void> {
  const callback = startCallbackServer(timeoutMs);
  try {
    let opened = false;
    const provider = new McpOAuthProvider(server, (url) => {
      opened = true;
      onAuthorizeUrl?.(url.toString());
      openUrl(url.toString());
    });

    const first = await auth(provider, { serverUrl });
    if (first === "AUTHORIZED") return;
    if (!opened) {
      throw new Error("the server did not provide an authorization URL");
    }

    const { code } = await callback.result;
    const second = await auth(provider, {
      serverUrl,
      authorizationCode: code,
    });
    if (second !== "AUTHORIZED") {
      throw new Error("authorization did not complete");
    }
  } finally {
    callback.stop();
  }
}

export async function logoutMcpServer(server: string): Promise<void> {
  await deleteAuthBlob(blobKey(server, "tokens"));
  await deleteAuthBlob(blobKey(server, "client"));
  await deleteAuthBlob(blobKey(server, "verifier"));
}

type CallbackServer = {
  result: Promise<{ code: string }>;
  stop: () => void;
};

// Bind only to loopback and stop after settlement or timeout.
function startCallbackServer(timeoutMs: number): CallbackServer {
  let settle!: (value: { code: string }) => void;
  let fail!: (err: Error) => void;
  const pending = new Promise<{ code: string }>((res, rej) => {
    settle = res;
    fail = rej;
  });

  const server = Bun.serve({
    port: REDIRECT_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response("Not found", { status: 404 });
      }
      const err = url.searchParams.get("error");
      if (err) {
        // RFC 6749 §4.1.2.1 puts the human-readable reason here; without it a
        // bare "access_denied" is the whole story.
        const desc = url.searchParams.get("error_description");
        fail(new Error(`authorization failed: ${desc ? `${err} — ${desc}` : err}`));
        return callbackPage("Login failed. You can close this tab.");
      }
      const code = url.searchParams.get("code");
      if (!code) {
        fail(new Error("authorization response had no code"));
        return callbackPage("Login could not be verified. You can close this tab.");
      }
      settle({ code });
      return callbackPage("Signed in to syd. You can close this tab.");
    },
  });

  const timer = setTimeout(
    () => fail(new Error("login timed out — no response from the browser")),
    timeoutMs,
  );

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    // Do not force-close while the browser may still be receiving the result page.
    server.stop();
  };
  const result = pending.finally(stop);

  return { result, stop };
}

function callbackPage(message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:3rem;text-align:center">` +
      `<h2>${message}</h2></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
