import type { ModelMessage } from "ai";

export type ToolNote = {
  label: string;
  diffText?: string;
};

export type SystemTone = "note" | "warn" | "error";

export const SYSTEM_TONES: readonly SystemTone[] = ["note", "warn", "error"];

export function isSystemTone(value: unknown): value is SystemTone {
  return (
    typeof value === "string" && SYSTEM_TONES.includes(value as SystemTone)
  );
}

export type Entry =
  | { kind: "user"; text: string; msgs: ModelMessage[] }
  | { kind: "assistant"; text: string; msgs: ModelMessage[] }
  | { kind: "tool"; note: ToolNote }
  | { kind: "notice"; text: string; tone?: SystemTone };

export type HistoryEntry = Extract<Entry, { msgs: ModelMessage[] }>;

export function carriesHistory(entry: Entry): entry is HistoryEntry {
  return entry.kind === "user" || entry.kind === "assistant";
}

export function toModelMessages(log: Entry[]): ModelMessage[] {
  return log.flatMap((entry) => (carriesHistory(entry) ? entry.msgs : []));
}

const entrySizes = new WeakMap<object, number>();

export function historyChars(log: Entry[]): number {
  let total = 0;
  for (const entry of log) {
    const cached = entrySizes.get(entry);
    if (cached !== undefined) {
      total += cached;
      continue;
    }
    let size = 0;
    if (carriesHistory(entry)) {
      for (const msg of entry.msgs) {
        const serialized = (() => {
          try {
            return JSON.stringify(msg);
          } catch {
            return undefined;
          }
        })();
        size += serialized?.length ?? 0;
      }
    }
    entrySizes.set(entry, size);
    total += size;
  }
  return total;
}

export function closeTurn(
  log: Entry[],
  produced: ModelMessage[],
  cancelled: boolean,
): Entry[] {
  const fallback = (text: string): ModelMessage[] => [
    {
      role: "assistant",
      content:
        text.length > 0
          ? text
          : cancelled
            ? "[the user cancelled this response]"
            : "[this response failed to complete]",
    },
  ];

  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.kind !== "assistant") continue;
    const next = [...log];
    next[i] = {
      ...entry,
      msgs: produced.length > 0 ? produced : fallback(entry.text),
    };
    return next;
  }

  return produced.length > 0
    ? [...log, { kind: "assistant", text: "", msgs: produced }]
    : log;
}

export type CommandContext = {
  addSystemMessage: (text: string, tone?: SystemTone) => void;
  newSession: () => void;
  resumeSession: (id?: string) => void | Promise<void>;
  setSessionTitle: (title: string) => void;
  setModel: (model?: string) => void;
  setProvider: (id?: string) => void;
  setReasoning: (level?: string) => void;
  copyLastResponse: () => void | Promise<void>;
  setAutoApprove: (auto: boolean) => void;
  toggleAutoApprove: () => void;
  showHelp: () => void;
  showSettings: () => void;
  showSkills: () => void;
  showTheme: () => void;
  showMcpTools: () => void;
  reloadMcp: () => void | Promise<void>;
  loginMcp: (server: string) => void | Promise<void>;
  addMcpServer: (
    name: string,
    url: string,
    oauth: boolean,
  ) => void | Promise<void>;
  removeMcpServer: (name: string) => void | Promise<void>;
  exit: () => void;
};

export type Command = {
  name: string;
  description: string;
  run: (args: string, ctx: CommandContext) => void | Promise<void>;
};
