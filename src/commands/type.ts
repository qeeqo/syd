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

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  toolNote?: ToolNote;
  tone?: SystemTone;
};

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
