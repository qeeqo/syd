// Per-server failures warn and skip. Gate externally defined tools unless the
// user explicitly marks their server trusted.

import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import { startupAuthProvider, hasMcpTokens } from "./mcpOAuth";

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
  auth?: "oauth";
};

export type McpServerConfig = StdioServer | HttpServer;

export type McpRuntime = {
  tools: ToolSet;
  gated: string[];
  // Retained for subprocess/socket cleanup on exit.
  clients: MCPClient[];
  warnings: string[];
};

// Allow cold npx installs, but do not let a wedged server block startup.
const CONNECT_TIMEOUT_MS = 20_000;

// So one server that won't close cleanly can't stall exit or a /mcp reload.
const CLOSE_TIMEOUT_MS = 2_000;

const MAX_MCP_RESULT_CHARS = 100_000;

const MIN_USEFUL_CLAMP = 200;

function headClamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[${text.length - max} more characters truncated]`;
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function partLabel(part: unknown): string {
  const type = (part as { type?: unknown } | null)?.type;
  return typeof type === "string" ? `${type} content` : "content";
}

export function clampMcpResult(result: unknown, max: number): unknown {
  if (typeof result === "string") return headClamp(result, max);
  if (typeof result !== "object" || result === null) return result;

  const total = jsonSize(result);
  if (total === 0 || total <= max) return result;

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return headClamp(JSON.stringify(result), max);

  let budget = max;
  const clamped = content.map((part) => {
    const size = jsonSize(part);
    if (size !== 0 && size <= budget) {
      budget -= size;
      return part;
    }
    const remaining = budget;
    budget = 0;
    if (remaining >= MIN_USEFUL_CLAMP && isTextPart(part)) {
      return { ...part, text: headClamp(part.text, remaining) };
    }
    return {
      type: "text",
      text: `[${partLabel(part)} omitted — ${size} characters exceeded the result budget]`,
    };
  });
  return { ...result, content: clamped };
}

type ExecutableTool = { execute?: (...args: unknown[]) => unknown };

export function capToolResult(toolDef: unknown): unknown {
  if (typeof toolDef !== "object" || toolDef === null) return toolDef;
  const def = toolDef as ExecutableTool;
  const original = def.execute;
  if (typeof original !== "function") return toolDef;
  return {
    ...def,
    execute: async (...args: unknown[]) =>
      clampMcpResult(await original.apply(def, args), MAX_MCP_RESULT_CHARS),
  };
}

export function emptyMcpRuntime(): McpRuntime {
  return { tools: {} as ToolSet, gated: [], clients: [], warnings: [] };
}

// Resolve ${VAR} references at connect time and warn when they expand empty.
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

// The SDK transport preserves PATH/HOME, allowing npx-style commands.
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
      // Startup auth must not open a browser before the TUI exists.
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

// Namespaced entries rather than a map, so the caller merges them in config
// order and duplicate resolution can't depend on who finished first.
type ServerResult = {
  entries: [string, unknown][];
  client?: MCPClient;
  warnings: string[];
};

// Never rejects — a failed server is a warning, not an aborted startup, which
// also keeps one bad server from settling the whole Promise.all early.
async function connectServer(
  name: string,
  server: McpServerConfig,
): Promise<ServerResult> {
  const warnings: string[] = [];
  const entries: [string, unknown][] = [];

  if (
    "url" in server &&
    server.auth === "oauth" &&
    !(await hasMcpTokens(name))
  ) {
    warnings.push(`mcp: server "${name}" needs login — run /mcp login ${name}`);
    return { entries, warnings };
  }

  let client: MCPClient | undefined;
  try {
    const transport = buildTransport(name, server, warnings);
    client = await connectWithTimeout({
      transport,
      // Errors are handled per server below; suppress the SDK's process-level callback.
      onUncaughtError: () => {},
    });
    const serverTools = await client.tools();

    for (const [toolName, toolDef] of Object.entries(serverTools)) {
      entries.push([`${name}__${toolName}`, capToolResult(toolDef)]);
    }
    return { entries, client, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Translate the SDK's refresh failure into an actionable login warning.
    if (msg.includes("authorization required")) {
      warnings.push(`mcp: server "${name}" needs login — run /mcp login ${name}`);
    } else {
      warnings.push(`mcp: server "${name}" failed — ${msg}`);
    }
    // So a server that connected but failed on tools() doesn't leak.
    if (client) await client.close().catch(() => {});
    return { entries, warnings };
  }
}

export async function connectMcpServers(
  servers: Record<string, McpServerConfig> | undefined,
): Promise<McpRuntime> {
  // MCP's dynamic schemas require a wider map during per-key assignment.
  const tools: Record<string, unknown> = {};
  const gated: string[] = [];
  const clients: MCPClient[] = [];
  const warnings: string[] = [];

  if (servers) {
    const declared = Object.entries(servers);
    // Connected concurrently: each server carries its own 20s timeout, so
    // startup costs the slowest one rather than the sum of them all.
    const results = await Promise.all(
      declared.map(([name, server]) => connectServer(name, server)),
    );

    // Merged in config order, so tool precedence and warning order stay
    // deterministic no matter what order the connects resolved in.
    declared.forEach(([name, server], i) => {
      const result = results[i];
      warnings.push(...result.warnings);
      if (result.client) clients.push(result.client);

      let added = 0;
      for (const [key, toolDef] of result.entries) {
        if (key in tools) {
          warnings.push(`mcp: duplicate tool ${key} — skipping the later one`);
          continue;
        }
        tools[key] = toolDef;
        if (server.trust !== "trusted") gated.push(key);
        added++;
      }
      if (result.client && added === 0) {
        warnings.push(`mcp: server "${name}" connected but exposed no tools`);
      }
    });
  }

  return { tools: tools as ToolSet, gated, clients, warnings };
}

// Close independently and bound shutdown so a dead client cannot block exit.
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
