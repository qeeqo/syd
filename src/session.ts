import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
import { isSystemTone, type Message } from "./commands/type.ts";
import { isProviderId, type ProviderId } from "./providers.ts";

export type Session = {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  messages: Message[];
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

function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    typeof m.content === "string"
  );
}

function sanitizeMessage(m: Message): Message {
  if (m.tone === undefined || isSystemTone(m.tone)) return m;
  // Preserve the session while dropping an unrecognized tone.
  return { ...m, tone: undefined };
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
    Array.isArray(s.messages) &&
    s.messages.every(isMessage) &&
    typeof s.cwd === "string" &&
    typeof s.createdAt === "number" &&
    typeof s.updatedAt === "number";
  if (!valid) return null;

  return {
    id: s.id as string,
    title: s.title as string,
    provider: (s.provider as ProviderId | undefined) ?? "google",
    model: s.model as string,
    messages: (s.messages as Message[]).map(sanitizeMessage),
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
    id: crypto.randomUUID(),
    title: "New Chat",
    provider,
    model,
    messages: [],
    cwd: process.cwd(),
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveSession(session: Session): Promise<void> {
  await ensureDir();
  const toWrite: Session = { ...session, updatedAt: Date.now() };
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
