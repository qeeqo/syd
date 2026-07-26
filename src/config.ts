// User configuration — pure disk I/O, no React, no TUI.
// Front-end agnostic (like session.ts) so a future CLI / neovim core can
// share it.
//
// Lives at ~/.sydcli/config.json — a plain, hand-editable file. Deliberately
// NOT auth.json: that one holds secrets under chmod 600 with an atomic-write
// ceremony (see auth.ts). This holds only non-secret preferences the user is
// meant to `cd ~ && $EDITOR` freely, so it stays an ordinary file.
//
// Precedence, mirroring auth.ts's "real env wins" rule:
//   built-in defaults  <  config.json  <  live session changes (/model, /auto)
// The file only seeds startup; nothing here writes it back.

import { homedir } from "node:os";
import { join } from "node:path";
import { providers, isProviderId, type ProviderId } from "./providers.ts";
import type { McpServerConfig, McpTrust } from "./mcp.ts";

const CONFIG_FILE = join(homedir(), ".sydcli", "config.json");

// The resolved, complete configuration. Every field on disk is optional;
// loadConfig fills the gaps so callers always get a whole object.
export type Config = {
  provider: ProviderId;
  model: string;
  autoApprove: boolean;
  // MCP servers to connect at startup, keyed by a short name that also
  // namespaces the server's tools. Empty when none are configured.
  mcpServers: Record<string, McpServerConfig>;
};

// Built-in fallbacks, used when the file is absent, corrupt, or partial.
// These match App.tsx's previous hardcoded startup defaults so no-config
// behavior is unchanged.
const DEFAULT_PROVIDER: ProviderId = "google";
const DEFAULT_MODEL = "gemini-3.6-flash";

export function defaultConfig(): Config {
  return {
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    autoApprove: false,
    mcpServers: {},
  };
}

// --- mcpServers parsing -----------------------------------------------------
// The whole block is validated defensively, entry by entry: a single malformed
// server is skipped with a warning without discarding the others, mirroring how
// the top-level fields degrade independently.

function parseTrust(
  name: string,
  value: unknown,
  warnings: string[],
): McpTrust {
  if (value === undefined) return "prompt";
  if (value === "prompt" || value === "trusted") return value;
  warnings.push(
    `config: mcp server "${name}" trust must be "prompt" or "trusted" — using prompt`,
  );
  return "prompt";
}

function parseStringArray(
  name: string,
  field: string,
  value: unknown,
  warnings: string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    warnings.push(
      `config: mcp server "${name}" ${field} must be an array of strings — ignoring it`,
    );
    return undefined;
  }
  return value as string[];
}

function parseStringRecord(
  name: string,
  field: string,
  value: unknown,
  warnings: string[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push(
      `config: mcp server "${name}" ${field} must be an object of strings — ignoring it`,
    );
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") out[key] = val;
    else
      warnings.push(
        `config: mcp server "${name}" ${field}.${key} must be a string — ignoring it`,
      );
  }
  return out;
}

function parseOneServer(
  name: string,
  raw: unknown,
  warnings: string[],
): McpServerConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    warnings.push(`config: mcp server "${name}" must be an object — skipping`);
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const trust = parseTrust(name, obj.trust, warnings);

  const hasUrl = typeof obj.url === "string" && obj.url.trim().length > 0;
  const hasCommand =
    typeof obj.command === "string" && obj.command.trim().length > 0;

  if (hasUrl && hasCommand) {
    warnings.push(
      `config: mcp server "${name}" has both "command" and "url" — skipping`,
    );
    return null;
  }

  // HTTP / SSE server.
  if (hasUrl) {
    let transport: "http" | "sse" = "http";
    if (obj.transport !== undefined) {
      if (obj.transport === "http" || obj.transport === "sse") {
        transport = obj.transport;
      } else {
        warnings.push(
          `config: mcp server "${name}" transport must be "http" or "sse" for a url server — using http`,
        );
      }
    }
    return {
      transport,
      url: (obj.url as string).trim(),
      headers: parseStringRecord(name, "headers", obj.headers, warnings),
      trust,
    };
  }

  // Stdio (subprocess) server.
  if (hasCommand) {
    if (obj.transport !== undefined && obj.transport !== "stdio") {
      warnings.push(
        `config: mcp server "${name}" transport must be "stdio" for a command server — using stdio`,
      );
    }
    const cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;
    return {
      transport: "stdio",
      command: (obj.command as string).trim(),
      args: parseStringArray(name, "args", obj.args, warnings),
      env: parseStringRecord(name, "env", obj.env, warnings),
      cwd,
      trust,
    };
  }

  warnings.push(
    `config: mcp server "${name}" needs either "command" (stdio) or "url" (http) — skipping`,
  );
  return null;
}

function parseMcpServers(
  value: unknown,
  warnings: string[],
): Record<string, McpServerConfig> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push("config: mcpServers must be a JSON object — ignoring it");
    return {};
  }
  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    const parsed = parseOneServer(name, raw, warnings);
    if (parsed) out[name] = parsed;
  }
  return out;
}

// Where the config file lives — exposed so a /help line or error can point the
// user at the exact path.
export function configPath(): string {
  return CONFIG_FILE;
}

// Load the user config, defensively. The file is hand-editable and may be
// missing, corrupt, or partial — this never throws. Each field is validated
// independently and a bad one falls back to its default WITHOUT discarding the
// others, so a single typo doesn't wipe the whole config. Returns the resolved
// Config plus human-readable warnings the caller can surface in the transcript
// (empty when the file is simply absent — no config is the normal case).
export async function loadConfig(): Promise<{
  config: Config;
  warnings: string[];
}> {
  const warnings: string[] = [];

  let raw: unknown;
  try {
    raw = await Bun.file(CONFIG_FILE).json();
  } catch {
    // Missing / unreadable / not-JSON → pure defaults, silently. A syntax
    // error is worth flagging, though, so distinguish the two: only warn if
    // the file actually exists.
    if (await Bun.file(CONFIG_FILE).exists()) {
      warnings.push(
        `config.json isn't valid JSON — ignoring it (${configPath()})`,
      );
    }
    return { config: defaultConfig(), warnings };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    warnings.push("config.json must be a JSON object — using defaults");
    return { config: defaultConfig(), warnings };
  }
  const obj = raw as Record<string, unknown>;

  // provider — must be a known id.
  let provider = DEFAULT_PROVIDER;
  if (obj.provider !== undefined) {
    if (typeof obj.provider === "string" && isProviderId(obj.provider)) {
      provider = obj.provider;
    } else {
      warnings.push(
        `config: unknown provider ${JSON.stringify(
          obj.provider,
        )} — using ${DEFAULT_PROVIDER}`,
      );
    }
  }

  // model — any non-empty string. When absent, fall back to the chosen
  // provider's own default so a "provider only" config lands on a valid model
  // rather than a mismatched one.
  const providerHadModel = obj.provider !== undefined && provider !== DEFAULT_PROVIDER;
  let model = providerHadModel ? providers[provider].defaultModel : DEFAULT_MODEL;
  if (obj.model !== undefined) {
    if (typeof obj.model === "string" && obj.model.trim().length > 0) {
      model = obj.model.trim();
    } else {
      warnings.push(`config: model must be a non-empty string — using ${model}`);
    }
  }

  // autoApprove — a boolean. Off is the safe default (writes ask first).
  let autoApprove = false;
  if (obj.autoApprove !== undefined) {
    if (typeof obj.autoApprove === "boolean") {
      autoApprove = obj.autoApprove;
    } else {
      warnings.push("config: autoApprove must be true or false — using false");
    }
  }

  // mcpServers — validated entry by entry; bad entries are skipped, not fatal.
  const mcpServers = parseMcpServers(obj.mcpServers, warnings);

  return { config: { provider, model, autoApprove, mcpServers }, warnings };
}
