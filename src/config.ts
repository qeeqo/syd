// Lives at ~/.sydcli/config.json — a plain, hand-editable file. Deliberately
// NOT auth.json: that one holds secrets under 0600 with an atomic-write
// ceremony. This holds only non-secret preferences, so it stays ordinary.
//
// Precedence: built-in defaults < config.json < live session changes.
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

// Every field on disk is optional; loadConfig fills the gaps so callers always
// get a whole object.
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

// Used when the file is absent, corrupt, or partial.
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
    theme: DEFAULT_THEME_NAME,
    reasoning: DEFAULT_REASONING_LEVEL,
  };
}

// --- mcpServers parsing -----------------------------------------------------
// Validated entry by entry: one malformed server is skipped with a warning
// without discarding the others.

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
    // Anything other than "oauth" falls back to header/no auth with a warning.
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

// --- skills parsing ---------------------------------------------------------
// Two on-disk shapes are accepted for hand-editing convenience: a bare string
// ("review": "do X") or an object ("review": { "instructions": "do X" }). The
// key is normalized through the same rule the rest of the app uses, so a
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

// Exposed so a /help line or error can point at the exact path.
export function configPath(): string {
  return CONFIG_FILE;
}

// Never throws. Each field is validated independently and a bad one falls back
// to its default WITHOUT discarding the others, so one typo doesn't wipe the
// config. Warnings are empty when the file is simply absent — no config is the
// normal case.
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

  // provider
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

  // model — absent falls back to the chosen provider's own default, so a
  // "provider only" config lands on a valid model rather than a mismatched one.
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

  // mcpServers
  const mcpServers = parseMcpServers(obj.mcpServers, warnings);

  // skills
  const skills = parseSkills(obj.skills, warnings);

  // theme — anything unknown falls back rather than leaving the UI with no
  // palette.
  let theme = DEFAULT_THEME_NAME;
  if (obj.theme !== undefined) {
    if (typeof obj.theme === "string" && isThemeName(obj.theme)) {
      theme = obj.theme;
    } else if (
      typeof obj.theme === "string" &&
      isRetiredThemeName(obj.theme)
    ) {
      // A theme that shipped once and was removed. Legitimate history, not a
      // typo, so it migrates quietly — warning would nag every launch about a
      // choice the user can no longer make.
      theme = DEFAULT_THEME_NAME;
    } else {
      warnings.push(
        `config: unknown theme ${JSON.stringify(
          obj.theme,
        )} — using ${DEFAULT_THEME_NAME}`,
      );
    }
  }

  // reasoning — an unrecognized value falls back to "default" (send nothing),
  // the safe end: the worst case is a model thinking at its own default, not a
  // request rejected for an effort the provider doesn't know.
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

// --- Writing config.json ----------------------------------------------------
// These read the RAW object and touch only their own key, so keys this module
// doesn't model survive round-trips. Plain writes — auth.json's 0600 ceremony
// is deliberately not used, since nothing here is secret.

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

// Serializes every read-modify-write. Bun is single-threaded, but the
// read (await) … write (await) window still interleaves at await points — two
// writers reading the same snapshot and both writing their +1 back is a classic
// lost update. This promise chain is an async mutex closing that window.
let configWriteQueue: Promise<unknown> = Promise.resolve();

function withConfigLock<T>(critical: () => Promise<T>): Promise<T> {
  // `.then` with both handlers runs `critical` whether the prior holder settled
  // or threw, so one failed write never wedges the queue. The stored tail is
  // swallowed so the next caller doesn't inherit a rejection, while `run` still
  // rejects for the caller that actually failed.
  const run = configWriteQueue.then(critical, critical);
  configWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// {} if missing or the wrong shape — a corrupt block shouldn't crash an
// add/remove.
function rawMcpServers(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.mcpServers;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Only fields present in `patch` are written, so toggling one setting never
// rewrites the others.
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

// Returns false (no write) if it wasn't there, so the caller can say so rather
// than silently succeeding.
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

// Same defensive read as rawMcpServers.
function rawSkills(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.skills;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Written in the object form so a round-trip through loadConfig is lossless.
// The name is assumed already normalized by the caller.
export async function saveSkill(skill: Skill): Promise<void> {
  return withConfigLock(async () => {
    const raw = await readRawConfig();
    const skills = rawSkills(raw);
    skills[skill.name] = { instructions: skill.instructions };
    raw.skills = skills;
    await writeRawConfig(raw);
  });
}

// Returns false (no write) if it wasn't there, so the caller can report
// "no such skill" instead of a silent success.
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
