// Model Context Protocol (MCP) client — pure module, no React, no TUI.
// Connects to the MCP servers declared in config.json, pulls their tool lists,
// and merges them (namespaced) into a single ToolSet that chat.ts hands to
// streamText alongside the local project tools. Front-end agnostic like
// tools.ts / session.ts, so a future headless core can reuse it as-is.
//
// Fail-soft throughout: a server that won't connect, hangs, or exposes a bad
// entry becomes a warning and is skipped — it never throws into the TUI or
// takes the whole app down. This is the same disk/network-boundary discipline
// as config.ts / session.ts, applied to a subprocess/socket boundary.
//
// Trust model: every server's tools are approval-gated by default (fail
// closed), exactly like the local write tools — an MCP tool can do anything
// (open a PR, send a message) and its definition comes from an external source
// we don't control. A server the user explicitly marks `"trust": "trusted"`
// runs its tools without a prompt — the escape hatch for a server you own and
// use constantly.

import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import { startupAuthProvider, hasMcpTokens } from "./mcpOAuth";

// "prompt" (default): every tool call from this server asks first via the
// approval popup. "trusted": its tools run freely, like the read-only local
// tools.
export type McpTrust = "prompt" | "trusted";

// A server that speaks over stdio — a spawned subprocess. The common case for
// local MCP servers run via npx / uvx / a binary.
export type StdioServer = {
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  trust?: McpTrust;
};

// A server reachable over HTTP — Streamable HTTP ("http") or the older SSE
// transport ("sse").
export type HttpServer = {
  transport: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  trust?: McpTrust;
  // "oauth" → authenticate via an interactive OAuth login (src/mcpOAuth.ts)
  // instead of (or in addition to) static `headers`. Absent → header/no auth.
  auth?: "oauth";
};

export type McpServerConfig = StdioServer | HttpServer;

// The live result of connecting to the configured servers.
export type McpRuntime = {
  // All servers' tools, keyed `<server>__<tool>`, ready to spread into
  // streamText's `tools` next to the local project tools.
  tools: ToolSet;
  // Keys of tools that must pass through the approval popup — everything from a
  // non-trusted server. chat.ts turns this into streamText's toolApproval map.
  gated: string[];
  // Open clients, kept so the app can close them (and their subprocesses) on
  // exit. Never leak a handle.
  clients: MCPClient[];
  // Human-readable problems (a server that failed to connect, an unset env
  // reference) for the caller to surface as opening system messages.
  warnings: string[];
};

// A slow or wedged server must not block the whole app from starting, so each
// connection races this ceiling. Generous, because a cold `npx` download of a
// server package can be slow the first time.
const CONNECT_TIMEOUT_MS = 20_000;

// Expand ${VAR} references in a config string against process.env, so secrets
// (tokens, keys) live in the shell / .env — which auth.ts already loads — rather
// than in the hand-editable, unprotected config.json. An unset variable expands
// to "" and is reported, so a typo'd name fails visibly instead of silently
// sending an empty credential. `warnings` is appended to in place.
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

// Build the transport for one already-validated server. An HTTP server becomes
// a plain transport-config object; a stdio server becomes a subprocess
// transport (which inherits PATH/HOME so `npx`-style commands resolve).
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
      // OAuth servers get an auth provider backed by auth.json. The startup
      // variant refuses to open a browser, so a missing/expired token surfaces
      // as a "needs login" warning rather than a popup during startup.
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

// Race a connect against a timeout. If the connect wins, return the client. If
// the timeout wins, reject — and if the connect later resolves anyway, close
// that orphaned client so a slow server can't leak a subprocess.
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

// Connect to every configured server, merge their tools, and report what
// happened. Never throws: a per-server failure is caught, warned, and skipped
// so the rest of the app (and the other servers) keep working.
export async function connectMcpServers(
  servers: Record<string, McpServerConfig> | undefined,
): Promise<McpRuntime> {
  // Built as a loose map: MCP tools are dynamically-schema'd (their input type
  // is only known at runtime), which the invariant ToolSet index type rejects
  // on per-key assignment. Collect here, then widen once at the return.
  const tools: Record<string, unknown> = {};
  const gated: string[] = [];
  const clients: MCPClient[] = [];
  const warnings: string[] = [];

  if (servers) {
    for (const [name, server] of Object.entries(servers)) {
      // An OAuth server with no stored token can't connect yet — say so plainly
      // and skip, rather than attempting a connect that's bound to fail.
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
          // A transport-level error after connection (server crash, broken
          // pipe) must not become an unhandled rejection that kills the process.
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
        // A stored token that can't be refreshed lands here (the startup auth
        // provider throws instead of opening a browser) — surface it as a
        // re-login prompt, not a scary failure.
        if (msg.includes("authorization required")) {
          warnings.push(
            `mcp: server "${name}" needs login — run /mcp login ${name}`,
          );
        } else {
          warnings.push(`mcp: server "${name}" failed — ${msg}`);
        }
        // Best-effort cleanup of a half-open client, so a server that connected
        // but then failed on tools() never leaks its subprocess or socket.
        if (client) await client.close().catch(() => {});
      }
    }
  }

  return { tools: tools as ToolSet, gated, clients, warnings };
}

// Close every client, swallowing errors — used on exit. A client that's already
// down (its server crashed) must not stop the others from closing cleanly.
export async function closeMcpClients(clients: MCPClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}
