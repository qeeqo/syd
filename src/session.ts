// Session persistence — pure disk I/O, no React, no TUI.
// Deliberately front-end agnostic so the TUI, a future CLI, and a future
// neovim plugin can all share the same session store.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, unlink } from "node:fs/promises";
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

function filePath(id: string) {
  return join(SESSIONS_DIR, `${id}.json`);
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
  await Bun.write(filePath(session.id), JSON.stringify(toWrite, null, 2));
}

export async function loadSession(id: string): Promise<Session> {
  return Bun.file(filePath(id)).json();
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
      const session = (await Bun.file(
        join(SESSIONS_DIR, name),
      ).json()) as Session;
      if (cwd && session.cwd !== cwd) continue;
      sessions.push(session);
    } catch {
      // skip unreadable/corrupt files rather than crash the whole list
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}
