// config.json is hand-editable and non-secret, so unlike auth.json it uses
// ordinary permissions and writes.

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
import {
  isThemeName,
  isRetiredThemeName,
  DEFAULT_THEME_NAME,
} from "./theme.ts";
import {
  isReasoningLevel,
  DEFAULT_REASONING_LEVEL,
  type ReasoningLevel,
} from "./reasoning.ts";

const CONFIG_FILE = join(homedir(), ".sydcli", "config.json");

export type Config = {
  provider: ProviderId;
  model: string;
  autoApprove: boolean;
  // Opt-in because a shell command has no path-containment safety net.
  shellEnabled: boolean;
  // Keyed by a short name that also namespaces the server's tools.
  mcpServers: Record<string, McpServerConfig>;
  // Sorted by name, so the /skills list and @ palette have a stable order
  // regardless of insertion order.
  skills: Skill[];
  // Always a known id — an unknown value resolves to the default at load.
  theme: string;
  // "default" sends no reasoning option at all, which is what keeps
  // non-reasoning models working.
  reasoning: ReasoningLevel;
};

const DEFAULT_PROVIDER: ProviderId = "openai-chatgpt";
const DEFAULT_MODEL = "gpt-5.6-luna";

export function defaultConfig(): Config {
  return {
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    autoApprove: false,
    shellEnabled: false,
    mcpServers: {},
    skills: [],
    theme: DEFAULT_THEME_NAME,
    reasoning: DEFAULT_REASONING_LEVEL,
  };
}

// Skip malformed servers individually instead of discarding the whole block.

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

// Accept string and object forms for hand editing, normalizing keys into legal handles.

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
      warnings.push(
        `config: skill "${rawName}" has empty instructions — skipping`,
      );
      continue;
    }
    if (seen.has(name)) {
      warnings.push(
        `config: skill "${rawName}" duplicates @${name} — keeping the first`,
      );
      continue;
    }
    seen.add(name);
    // Clamp rather than reject — silently dropping the skill would be more
    // surprising than truncating it.
    const body =
      trimmed.length > MAX_SKILL_INSTRUCTIONS
        ? trimmed.slice(0, MAX_SKILL_INSTRUCTIONS)
        : trimmed;
    out.push({ name, instructions: body });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function configPath(): string {
  return CONFIG_FILE;
}

// Parse fields independently so one bad value does not discard the rest;
// an absent file is normal and emits no warning.
export async function loadConfig(): Promise<{
  config: Config;
  warnings: string[];
}> {
  const warnings: string[] = [];

  let raw: unknown;
  try {
    raw = await Bun.file(CONFIG_FILE).json();
  } catch {
    // Missing / unreadable / not-JSON → pure defaults. Only warn when the file
    // actually exists, so a syntax error is still flagged.
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

  // A non-default provider without a model uses its own default.
  const providerHadModel =
    obj.provider !== undefined && provider !== DEFAULT_PROVIDER;
  let model = providerHadModel
    ? providers[provider].defaultModel
    : DEFAULT_MODEL;
  if (obj.model !== undefined) {
    if (typeof obj.model === "string" && obj.model.trim().length > 0) {
      model = obj.model.trim();
    } else {
      warnings.push(
        `config: model must be a non-empty string — using ${model}`,
      );
    }
  }

  // autoApprove — off is the safe default (writes ask first).
  let autoApprove = false;
  if (obj.autoApprove !== undefined) {
    if (typeof obj.autoApprove === "boolean") {
      autoApprove = obj.autoApprove;
    } else {
      warnings.push("config: autoApprove must be true or false — using false");
    }
  }

  // shellEnabled — off is the safe default.
  let shellEnabled = false;
  if (obj.shellEnabled !== undefined) {
    if (typeof obj.shellEnabled === "boolean") {
      shellEnabled = obj.shellEnabled;
    } else {
      warnings.push("config: shellEnabled must be true or false — using false");
    }
  }

  const mcpServers = parseMcpServers(obj.mcpServers, warnings);

  const skills = parseSkills(obj.skills, warnings);

  let theme = DEFAULT_THEME_NAME;
  if (obj.theme !== undefined) {
    if (typeof obj.theme === "string" && isThemeName(obj.theme)) {
      theme = obj.theme;
    } else if (typeof obj.theme === "string" && isRetiredThemeName(obj.theme)) {
      // Retired themes migrate silently; warning on every launch would punish a
      // formerly valid choice.
      theme = DEFAULT_THEME_NAME;
    } else {
      warnings.push(
        `config: unknown theme ${JSON.stringify(
          obj.theme,
        )} — using ${DEFAULT_THEME_NAME}`,
      );
    }
  }

  // Unknown reasoning falls back to sending no option, avoiding provider rejection.
  let reasoning = DEFAULT_REASONING_LEVEL;
  if (obj.reasoning !== undefined) {
    if (isReasoningLevel(obj.reasoning)) {
      reasoning = obj.reasoning;
    } else {
      warnings.push(
        `config: unknown reasoning ${JSON.stringify(
          obj.reasoning,
        )} — using ${DEFAULT_REASONING_LEVEL}`,
      );
    }
  }

  return {
    config: {
      provider,
      model,
      autoApprove,
      shellEnabled,
      mcpServers,
      skills,
      theme,
      reasoning,
    },
    warnings,
  };
}

// Preserve unknown top-level keys during writes; ordinary permissions are
// sufficient because config.json contains no secrets.

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

// Serialize read-modify-write operations; await points can otherwise cause
// lost updates even on Bun's single thread.
let configWriteQueue: Promise<unknown> = Promise.resolve();

function withConfigLock<T>(critical: () => Promise<T>): Promise<T> {
  // Run after either prior outcome and swallow only the queued tail so one
  // failed write cannot wedge later writers.
  const run = configWriteQueue.then(critical, critical);
  configWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function rawMcpServers(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.mcpServers;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function saveSettings(patch: {
  autoApprove?: boolean;
  shellEnabled?: boolean;
  reasoning?: ReasoningLevel;
}): Promise<void> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    if (patch.autoApprove !== undefined) raw.autoApprove = patch.autoApprove;
    if (patch.shellEnabled !== undefined) raw.shellEnabled = patch.shellEnabled;
    if (patch.reasoning !== undefined) raw.reasoning = patch.reasoning;
    await writeRawConfig(raw);
  });
}

// The caller (the /theme picker) passes an id already validated against THEMES.
export async function saveTheme(name: string): Promise<void> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    raw.theme = name;
    await writeRawConfig(raw);
  });
}

export async function saveMcpServer(
  name: string,
  server: McpServerConfig,
): Promise<void> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    const servers = rawMcpServers(raw);
    servers[name] = server;
    raw.mcpServers = servers;
    await writeRawConfig(raw);
  });
}

// False means the server was absent and nothing was written.
export async function removeMcpServerFromConfig(
  name: string,
): Promise<boolean> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    const servers = rawMcpServers(raw);
    if (!(name in servers)) return false;
    delete servers[name];
    raw.mcpServers = servers;
    await writeRawConfig(raw);
    return true;
  });
}

function rawSkills(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.skills;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Callers supply normalized names.
export async function saveSkill(skill: Skill): Promise<void> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    const skills = rawSkills(raw);
    skills[skill.name] = { instructions: skill.instructions };
    raw.skills = skills;
    await writeRawConfig(raw);
  });
}

// False means the skill was absent and nothing was written.
export async function removeSkillFromConfig(name: string): Promise<boolean> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    const skills = rawSkills(raw);
    if (!(name in skills)) return false;
    delete skills[name];
    raw.skills = skills;
    await writeRawConfig(raw);
    return true;
  });
}
