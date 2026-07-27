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
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { providers, isProviderId, type ProviderId } from "./providers.ts";
import type { McpServerConfig, McpTrust } from "./mcp.ts";
import {
  normalizeSkillName,
  MAX_SKILL_INSTRUCTIONS,
  type Skill,
} from "./skills.ts";

const CONFIG_FILE = join(homedir(), ".sydcli", "config.json");

// The resolved, complete configuration. Every field on disk is optional;
// loadConfig fills the gaps so callers always get a whole object.
export type Config = {
  provider: ProviderId;
  model: string;
  autoApprove: boolean;
  // Whether syd may run shell commands (the runCommand tool). Off by default —
  // it's opt-in because a shell command has no path-containment safety net.
  // Toggled in /settings, which persists it here.
  shellEnabled: boolean;
  // MCP servers to connect at startup, keyed by a short name that also
  // namespaces the server's tools. Empty when none are configured.
  mcpServers: Record<string, McpServerConfig>;
  // Reusable user instructions invoked with @<name> in a message. Empty when
  // none are defined. Sorted by name so the /skills list and @ palette have a
  // stable order regardless of file/insertion order.
  skills: Skill[];
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
    shellEnabled: false,
    mcpServers: {},
    skills: [],
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
    // auth — only "oauth" is meaningful; anything else falls back to header/no
    // auth with a warning.
    let auth: "oauth" | undefined;
    if (obj.auth !== undefined) {
      if (obj.auth === "oauth") {
        auth = "oauth";
      } else {
        warnings.push(
          `config: mcp server "${name}" auth must be "oauth" (or omitted) — ignoring it`,
        );
      }
    }
    return {
      transport,
      url: (obj.url as string).trim(),
      headers: parseStringRecord(name, "headers", obj.headers, warnings),
      trust,
      ...(auth ? { auth } : {}),
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

// --- skills parsing ---------------------------------------------------------
// The `skills` object maps a handle to its instructions. Two on-disk shapes are
// accepted for hand-editing convenience: a bare string ("review": "do X"), or an
// object ("review": { "instructions": "do X" }). Each entry is validated
// independently — a bad one is skipped with a warning, never fatal — and the key
// is normalized through the same rule the rest of the app uses, so a
// hand-written "My Skill" still lands as a legal @handle.

function parseSkills(value: unknown, warnings: string[]): Skill[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push("config: skills must be a JSON object — ignoring it");
    return [];
  }
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const [rawName, raw] of Object.entries(value)) {
    const name = normalizeSkillName(rawName);
    if (!name) {
      warnings.push(
        `config: skill "${rawName}" has no usable name (letters, numbers, hyphens) — skipping`,
      );
      continue;
    }
    let instructions: string | undefined;
    if (typeof raw === "string") {
      instructions = raw;
    } else if (
      typeof raw === "object" &&
      raw !== null &&
      !Array.isArray(raw) &&
      typeof (raw as Record<string, unknown>).instructions === "string"
    ) {
      instructions = (raw as Record<string, string>).instructions;
    } else {
      warnings.push(
        `config: skill "${rawName}" must be a string or { instructions: string } — skipping`,
      );
      continue;
    }
    const trimmed = instructions.trim();
    if (trimmed.length === 0) {
      warnings.push(`config: skill "${rawName}" has empty instructions — skipping`);
      continue;
    }
    if (seen.has(name)) {
      warnings.push(
        `config: skill "${rawName}" duplicates @${name} — keeping the first`,
      );
      continue;
    }
    seen.add(name);
    // Clamp rather than reject: a slightly-too-long body still works, and
    // silently dropping the skill would be more surprising than truncating it.
    const body =
      trimmed.length > MAX_SKILL_INSTRUCTIONS
        ? trimmed.slice(0, MAX_SKILL_INSTRUCTIONS)
        : trimmed;
    out.push({ name, instructions: body });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
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

  // shellEnabled — a boolean. Off is the safe default (no shell access until
  // the user opts in via /settings).
  let shellEnabled = false;
  if (obj.shellEnabled !== undefined) {
    if (typeof obj.shellEnabled === "boolean") {
      shellEnabled = obj.shellEnabled;
    } else {
      warnings.push("config: shellEnabled must be true or false — using false");
    }
  }

  // mcpServers — validated entry by entry; bad entries are skipped, not fatal.
  const mcpServers = parseMcpServers(obj.mcpServers, warnings);

  // skills — same entry-by-entry discipline; a bad skill never poisons the rest.
  const skills = parseSkills(obj.skills, warnings);

  return {
    config: { provider, model, autoApprove, shellEnabled, mcpServers, skills },
    warnings,
  };
}

// --- Writing config.json ----------------------------------------------------
// Unlike loadConfig (which only reads and fills defaults), these mutate the
// file for the in-app /mcp-add and /mcp-remove commands. They read the RAW
// object and touch only mcpServers, so keys this module doesn't model (or hasn't
// yet) survive round-trips. Not a secret file, so a plain write — auth.json's
// 0600 ceremony is deliberately not used here.

// Read the file as a plain object, or {} when absent/corrupt/not-an-object.
async function readRawConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await Bun.file(CONFIG_FILE).json();
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    // Absent or unparseable → start from an empty object.
  }
  return {};
}

async function writeRawConfig(obj: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await Bun.write(CONFIG_FILE, JSON.stringify(obj, null, 2) + "\n");
}

// Pull the raw mcpServers object out of a raw config, or {} if it's missing or
// the wrong shape (a corrupt block shouldn't crash an add/remove).
function rawMcpServers(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.mcpServers;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Persist top-level scalar preferences (the /settings popup) without disturbing
// mcpServers or any other key — same RAW round-trip discipline as the mcp
// writers. Only fields present in `patch` are written, so a toggle of one
// setting never rewrites the others.
export async function saveSettings(patch: {
  autoApprove?: boolean;
  shellEnabled?: boolean;
}): Promise<void> {
  const raw = await readRawConfig();
  if (patch.autoApprove !== undefined) raw.autoApprove = patch.autoApprove;
  if (patch.shellEnabled !== undefined) raw.shellEnabled = patch.shellEnabled;
  await writeRawConfig(raw);
}

// Add or replace one MCP server in config.json, preserving every other key.
export async function saveMcpServer(
  name: string,
  server: McpServerConfig,
): Promise<void> {
  const raw = await readRawConfig();
  const servers = rawMcpServers(raw);
  servers[name] = server;
  raw.mcpServers = servers;
  await writeRawConfig(raw);
}

// Remove one MCP server from config.json. Returns false (no write) if it wasn't
// there, so the caller can tell the user rather than silently succeeding.
export async function removeMcpServerFromConfig(name: string): Promise<boolean> {
  const raw = await readRawConfig();
  const servers = rawMcpServers(raw);
  if (!(name in servers)) return false;
  delete servers[name];
  raw.mcpServers = servers;
  await writeRawConfig(raw);
  return true;
}

// Pull the raw skills object out of a raw config, or {} if missing / wrong
// shape — same defensive read as rawMcpServers.
function rawSkills(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.skills;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Add or replace one skill in config.json, preserving every other key. Written
// in the object form so a round-trip through loadConfig is lossless. The name
// is assumed already normalized (the callers — the editor and the model tool —
// normalize before persisting).
export async function saveSkill(skill: Skill): Promise<void> {
  const raw = await readRawConfig();
  const skills = rawSkills(raw);
  skills[skill.name] = { instructions: skill.instructions };
  raw.skills = skills;
  await writeRawConfig(raw);
}

// Remove one skill from config.json. Returns false (no write) if it wasn't
// there, so the caller can report "no such skill" instead of a silent success.
export async function removeSkillFromConfig(name: string): Promise<boolean> {
  const raw = await readRawConfig();
  const skills = rawSkills(raw);
  if (!(name in skills)) return false;
  delete skills[name];
  raw.skills = skills;
  await writeRawConfig(raw);
  return true;
}
