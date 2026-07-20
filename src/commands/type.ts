export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type CommandContext = {
  addSystemMessage: (text: string) => void;
  newSession: () => void;
  setSessionTitle: (title: string) => void;
  setModel: (model: string) => void;
  exit: () => void;
};

export type Command = {
  name: string;
  description: string;
  run: (args: string, ctx: CommandContext) => void | Promise<void>;
};
