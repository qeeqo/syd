// Fail-soft throughout: a server that won't connect, hangs, or exposes a bad
// entry becomes a warning and is skipped — it never throws into the TUI.
//
// Trust model: every server's tools are approval-gated by default. An MCP tool
// can do anything and its definition comes from a source we don't control.
// `"trust": "trusted"` is the escape hatch for a server the user owns.

import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import { startupAuthProvider, hasMcpTokens } from "./mcpOAuth";

// "trusted" runs a server's tools without a prompt, like the read-only local
// tools.
export type McpTrust = "prompt" | "trusted";

export type StdioServer = {
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  trust?: McpTrust;
};

export type HttpServer = {
  transport: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  trust?: McpTrust;
  // "oauth" → interactive login (src/mcpOAuth.ts) instead of static headers.
  auth?: "oauth";
};

export type McpServerConfig = StdioServer | HttpServer;

export type McpRuntime = {
  // Keyed `<server>__<tool>`, ready to spread beside the local tools.
  tools: ToolSet;
  // Tools that must pass through the approval popup — everything from a
  // non-trusted server.
  gated: string[];
  // Kept so the app can close them, and their subprocesses, on exit.
  clients: MCPClient[];
  // Surfaced by the caller as opening system messages.
  warnings: string[];
};

// A slow or wedged server must not block startup. Generous, because a cold
// `npx` download of a server package can be slow the first time.
const CONNECT_TIMEOUT_MS = 20_000;

// So one server that won't close cleanly can't stall exit or a /mcp reload.
const CLOSE_TIMEOUT_MS = 2_000;

// Kept here so callers don't hand-roll the shape.
export function emptyMcpRuntime(): McpRuntime {
  return { tools: {} as ToolSet, gated: [], clients: [], warnings: [] };
}

// Secrets live in the shell / .env — which auth.ts already loads — rather than
// in the hand-editable, unprotected config.json. An unset variable expands to ""
// and is reported, so a typo fails visibly instead of silently sending an empty
// credential. `warnings` is appended to in place.
function expandEnv(value: string, where: string, warnings: string[]): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined || resolved === "") {
        warnings.push(`mcp ${where}: environment variable $${name} is not set`);
        return "";
      }
      return resolved;
    },
  );
}

function expandRecord(
  record: Record<string, string> | undefined,
  where: string,
  warnings: string[],
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = expandEnv(value, where, warnings);
  }
  return out;
}

// A stdio server becomes a subprocess transport, which inherits PATH/HOME so
// `npx`-style commands resolve.
function buildTransport(
  name: string,
  server: McpServerConfig,
  warnings: string[],
): MCPClientConfig["transport"] {
  if ("url" in server) {
    return {
      type: server.transport,
      url: server.url,
      headers: expandRecord(
        server.headers,
        `server "${name}" headers`,
        warnings,
      ),
      // The startup variant refuses to open a browser, so a missing token
      // surfaces as a "needs login" warning rather than a popup mid-launch.
      ...(server.auth === "oauth"
        ? { authProvider: startupAuthProvider(name) }
        : {}),
    };
  }
  return new StdioMCPTransport({
    command: server.command,
    args: server.args,
    env: expandRecord(server.env, `server "${name}" env`, warnings),
    cwd: server.cwd,
  });
}

// If the timeout wins and the connect later resolves anyway, close that
// orphaned client so a slow server can't leak a subprocess.
async function connectWithTimeout(config: MCPClientConfig): Promise<MCPClient> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const connecting = createMCPClient(config);
  connecting
    .then((client) => {
      if (timedOut) void client.close().catch(() => {});
    })
    .catch(() => {});
  try {
    return await Promise.race([
      connecting,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new Error(`connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`),
          );
        }, CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Never throws: a per-server failure is caught, warned, and skipped so the
// other servers keep working.
export async function connectMcpServers(
  servers: Record<string, McpServerConfig> | undefined,
): Promise<McpRuntime> {
  // Loose map because MCP tools are dynamically-schema'd, which the invariant
  // ToolSet index type rejects on per-key assignment. Widened at the return.
  const tools: Record<string, unknown> = {};
  const gated: string[] = [];
  const clients: MCPClient[] = [];
  const warnings: string[] = [];

  if (servers) {
    for (const [name, server] of Object.entries(servers)) {
      // Bound to fail without a token, so say so plainly and skip.
      if (
        "url" in server &&
        server.auth === "oauth" &&
        !(await hasMcpTokens(name))
      ) {
        warnings.push(`mcp: server "${name}" needs login — run /mcp login ${name}`);
        continue;
      }

      let client: MCPClient | undefined;
      try {
        const transport = buildTransport(name, server, warnings);
        client = await connectWithTimeout({
          transport,
          // Must not become an unhandled rejection that kills the process.
          onUncaughtError: () => {},
        });
        const serverTools = await client.tools();

        let added = 0;
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          const key = `${name}__${toolName}`;
          if (key in tools) {
            warnings.push(`mcp: duplicate tool ${key} — skipping the later one`);
            continue;
          }
          tools[key] = toolDef;
          if (server.trust !== "trusted") gated.push(key);
          added++;
        }
        clients.push(client);
        if (added === 0) {
          warnings.push(`mcp: server "${name}" connected but exposed no tools`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A stored token that can't be refreshed lands here — surface it as a
        // re-login prompt, not a scary failure.
        if (msg.includes("authorization required")) {
          warnings.push(
            `mcp: server "${name}" needs login — run /mcp login ${name}`,
          );
        } else {
          warnings.push(`mcp: server "${name}" failed — ${msg}`);
        }
        // So a server that connected but failed on tools() doesn't leak.
        if (client) await client.close().catch(() => {});
      }
    }
  }

  return { tools: tools as ToolSet, gated, clients, warnings };
}

// Swallows errors: a client that's already down must not stop the others from
// closing. Bounded, because on exit the OS reclaims the socket anyway and a
// server that hangs its own close must never hold the app hostage.
export async function closeMcpClients(
  clients: MCPClient[],
  timeoutMs: number = CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (clients.length === 0) return;
  const closing = Promise.all(
    clients.map((client) => client.close().catch(() => {})),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([closing, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
