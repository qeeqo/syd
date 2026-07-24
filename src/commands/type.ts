export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type CommandContext = {
  addSystemMessage: (text: string) => void;
  newSession: () => void;
  // No id → list resumable sessions; id (or unique prefix) → resume that one.
  resumeSession: (id?: string) => void | Promise<void>;
  setSessionTitle: (title: string) => void;
  setModel: (model: string) => void;
  // No id → open the provider picker; id → switch directly (if key is set).
  setProvider: (id?: string) => void;
  // Copy the most recent assistant response to the system clipboard.
  copyLastResponse: () => void | Promise<void>;
  exit: () => void;
};

export type Command = {
  name: string;
  description: string;
  run: (args: string, ctx: CommandContext) => void | Promise<void>;
};
