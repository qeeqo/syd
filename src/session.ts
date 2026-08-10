import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
import type { ModelMessage } from "ai";
import {
  carriesHistory,
  isSystemTone,
  type Entry,
  type ToolNote,
} from "./commands/type.ts";
import { isProviderId, type ProviderId } from "./providers.ts";

export const SESSION_FORMAT = 2;

export type Session = {
  version: number;
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  entries: Entry[];
  cwd: string;
  createdAt: number;
  updatedAt: number;
};

const SESSIONS_DIR = join(homedir(), ".sydcli", "sessions");

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function filePath(id: string) {
  if (!isValidSessionId(id)) throw new Error(`invalid session id: ${id}`);
  return join(SESSIONS_DIR, `${id}.json`);
}

function parseToolNote(value: unknown): ToolNote | null {
  if (typeof value !== "object" || value === null) return null;
  const n = value as Record<string, unknown>;
  if (typeof n.label !== "string") return null;
  return typeof n.diffText === "string"
    ? { label: n.label, diffText: n.diffText }
    : { label: n.label };
}

function parseMsgs(value: unknown): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  const usable = value.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as { role?: unknown }).role === "string" &&
      "content" in (m as object),
  );
  return usable ? (value as ModelMessage[]) : [];
}

function parseEntry(value: unknown): Entry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  switch (e.kind) {
    case "user":
    case "assistant": {
      if (typeof e.text !== "string") return null;
      return { kind: e.kind, text: e.text, msgs: parseMsgs(e.msgs) };
    }
    case "tool": {
      const note = parseToolNote(e.note);
      return note ? { kind: "tool", note } : null;
    }
    case "notice": {
      if (typeof e.text !== "string") return null;
      return isSystemTone(e.tone)
        ? { kind: "notice", text: e.text, tone: e.tone }
        : { kind: "notice", text: e.text };
    }
    default:
      return null;
  }
}

function assignLiftedMsgs(entries: Entry[]): Entry[] {
  const out = [...entries];
  const indices = out
    .map((e, i) => (carriesHistory(e) ? i : -1))
    .filter((i) => i !== -1);

  let start = 0;
  while (start < indices.length) {
    const kind = (out[indices[start]] as { kind: "user" | "assistant" }).kind;
    let end = start;
    while (
      end + 1 < indices.length &&
      (out[indices[end + 1]] as { kind: string }).kind === kind
    ) {
      end++;
    }

    const run = indices.slice(start, end + 1);
    const text = run
      .map((i) => (out[i] as { text: string }).text)
      .filter((t) => t.length > 0)
      .join("\n\n");

    for (const i of run) {
      const entry = out[i] as Extract<Entry, { msgs: ModelMessage[] }>;
      out[i] = { ...entry, msgs: [] };
    }
    if (text.length > 0) {
      const last = out[run[run.length - 1]] as Extract<
        Entry,
        { msgs: ModelMessage[] }
      >;
      out[run[run.length - 1]] = {
        ...last,
        msgs: [{ role: kind, content: text }],
      };
    }

    start = end + 1;
  }

  return out;
}

function liftV1(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  const entries: Entry[] = [];

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.content !== "string") continue;

    if (m.role === "user" || m.role === "assistant") {
      entries.push({ kind: m.role, text: m.content, msgs: [] });
      continue;
    }
    if (m.role !== "system") continue;

    const note = parseToolNote(m.toolNote);
    if (note) {
      entries.push({ kind: "tool", note });
    } else if (isSystemTone(m.tone)) {
      entries.push({ kind: "notice", text: m.content, tone: m.tone });
    } else {
      entries.push({ kind: "notice", text: m.content });
    }
  }

  return assignLiftedMsgs(entries);
}

function parseSession(value: unknown): Session | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;

  const valid =
    typeof s.id === "string" &&
    isValidSessionId(s.id) &&
    typeof s.title === "string" &&
    (s.provider === undefined ||
      (typeof s.provider === "string" && isProviderId(s.provider))) &&
    typeof s.model === "string" &&
    typeof s.cwd === "string" &&
    typeof s.createdAt === "number" &&
    typeof s.updatedAt === "number";
  if (!valid) return null;

  const version = typeof s.version === "number" ? s.version : 1;
  if (version > SESSION_FORMAT) return null;

  let entries: Entry[];
  if (version < SESSION_FORMAT) {
    entries = liftV1(s.messages);
  } else {
    if (!Array.isArray(s.entries)) return null;
    const parsed = s.entries.map(parseEntry);
    entries = parsed.filter((e): e is Entry => e !== null);
  }

  return {
    version: SESSION_FORMAT,
    id: s.id as string,
    title: s.title as string,
    provider: (s.provider as ProviderId | undefined) ?? "google",
    model: s.model as string,
    entries,
    cwd: s.cwd as string,
    createdAt: s.createdAt as number,
    updatedAt: s.updatedAt as number,
  };
}

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export function createSession(provider: ProviderId, model: string): Session {
  const now = Date.now();
  return {
    version: SESSION_FORMAT,
    id: crypto.randomUUID(),
    title: "New Chat",
    provider,
    model,
    entries: [],
    cwd: process.cwd(),
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveSession(session: Session): Promise<void> {
  await ensureDir();
  const toWrite: Session = {
    ...session,
    version: SESSION_FORMAT,
    updatedAt: Date.now(),
  };
  const target = filePath(session.id);
  const tmp = `${target}.tmp`;
  await Bun.write(tmp, JSON.stringify(toWrite, null, 2));
  await rename(tmp, target);
}

export async function loadSession(id: string): Promise<Session | null> {
  if (!isValidSessionId(id)) return null;
  try {
    const data: unknown = await Bun.file(filePath(id)).json();
    return parseSession(data);
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  await unlink(filePath(id));
}

export async function listSessions(cwd?: string): Promise<Session[]> {
  await ensureDir();
  const entries = await readdir(SESSIONS_DIR);
  const sessions: Session[] = [];

  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const data: unknown = await Bun.file(join(SESSIONS_DIR, name)).json();
      const session = parseSession(data);
      if (!session) continue;
      if (cwd && session.cwd !== cwd) continue;
      sessions.push(session);
    } catch {
      // Skip corrupt files without failing the whole history list.
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findSessionsByIdPrefix(
  prefix: string,
  cwd?: string,
): Promise<Session[]> {
  const needle = prefix.toLowerCase();
  const sessions = await listSessions(cwd);
  return sessions.filter((s) => s.id.startsWith(needle));
}
