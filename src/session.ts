// Session persistence — pure disk I/O, no React, no TUI.
// Deliberately front-end agnostic so the TUI, a future CLI, and a future
// neovim plugin can all share the same session store.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
import type { Message } from "./commands/type.ts";

export type Session = {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  cwd: string;
  createdAt: number;
  updatedAt: number;
};

// Global store, keyed by cwd inside each file (the "hybrid" model):
// physical storage is centralized, logical grouping is by project.
const SESSIONS_DIR = join(homedir(), ".sydcli", "sessions");

// Ids are UUIDs we mint ourselves (crypto.randomUUID). Enforce that shape
// before an id is ever used in a path, so user-supplied input like
// "/resume ../../etc" can never escape SESSIONS_DIR.
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function filePath(id: string) {
  if (!isValidSessionId(id)) throw new Error(`invalid session id: ${id}`);
  return join(SESSIONS_DIR, `${id}.json`);
}

// Runtime guards for data crossing the disk boundary. Files under ~/.sydcli
// can be hand-edited or half-written, so `as Session` casts aren't safe —
// a malformed file must fail the load, not crash the renderer later.
function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    typeof m.content === "string"
  );
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    isValidSessionId(s.id) &&
    typeof s.title === "string" &&
    typeof s.model === "string" &&
    Array.isArray(s.messages) &&
    s.messages.every(isMessage) &&
    typeof s.cwd === "string" &&
    typeof s.createdAt === "number" &&
    typeof s.updatedAt === "number"
  );
}

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

// In-memory factory — does NOT touch disk. A session is only persisted once
// it has content (see saveSession callers), so we don't litter empty files.
export function createSession(model: string): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
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
  // Write-then-rename: rename within a directory is atomic on POSIX, so a
  // crash mid-write leaves a stale .tmp behind instead of a corrupt session.
  const target = filePath(session.id);
  const tmp = `${target}.tmp`;
  await Bun.write(tmp, JSON.stringify(toWrite, null, 2));
  await rename(tmp, target);
}

// Returns null for missing, unreadable, or schema-invalid files — callers
// treat all three the same way: "that session isn't available".
export async function loadSession(id: string): Promise<Session | null> {
  if (!isValidSessionId(id)) return null;
  try {
    const data: unknown = await Bun.file(filePath(id)).json();
    return isSession(data) ? data : null;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  await unlink(filePath(id));
}

// Lists sessions newest-first. Pass a cwd to get the project-scoped view
// (the "/sessions here" case); omit it for the full global history.
export async function listSessions(cwd?: string): Promise<Session[]> {
  await ensureDir();
  const entries = await readdir(SESSIONS_DIR);
  const sessions: Session[] = [];

  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const data: unknown = await Bun.file(join(SESSIONS_DIR, name)).json();
      if (!isSession(data)) continue;
      if (cwd && data.cwd !== cwd) continue;
      sessions.push(data);
    } catch {
      // skip unreadable/corrupt files rather than crash the whole list
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Resolve a full id or unique id prefix (git-style short ids) against the
// sessions visible in `cwd`. Returns all matches so the caller can
// distinguish not-found (0) from ambiguous (2+).
export async function findSessionsByIdPrefix(
  prefix: string,
  cwd?: string,
): Promise<Session[]> {
  const needle = prefix.toLowerCase();
  const sessions = await listSessions(cwd);
  return sessions.filter((s) => s.id.startsWith(needle));
}
