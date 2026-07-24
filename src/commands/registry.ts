import type { Command, CommandContext } from "./type.ts";

const help: Command = {
  name: "help",
  description: "Show all available commands",
  run: (_args, ctx) => {
    const lines = Object.values(commands).map(
      (c) => `/${c.name}  ${c.description}`,
    );
    ctx.addSystemMessage(lines.join("\n"));
  },
};

const newChat: Command = {
  name: "new",
  description: "Start a new session chat",
  run: (_args, ctx) => ctx.newSession(),
};

const resume: Command = {
  name: "resume",
  description: "List sessions in this directory, or resume one by id",
  run: (args, ctx) => ctx.resumeSession(args.trim() || undefined),
};

const rename: Command = {
  name: "rename",
  description: "Rename the current session",
  run: (args, ctx) => {
    const title = args.trim();
    if (!title) {
      ctx.addSystemMessage("usage: /rename <new title>");
      return;
    }
    ctx.setSessionTitle(title);
  },
};

const model: Command = {
  name: "model",
  description: "Switch the active model",
  run: (args, ctx) => {
    const name = args.trim();
    if (!name) {
      ctx.addSystemMessage("usage: /model <model-name>");
      return;
    }
    ctx.setModel(name);
  },
};

const provider: Command = {
  name: "provider",
  description: "Switch AI provider (google, anthropic, openai)",
  run: (args, ctx) => ctx.setProvider(args.trim() || undefined),
};

const copy: Command = {
  name: "copy",
  description: "Copy the latest response to the clipboard",
  run: (_args, ctx) => ctx.copyLastResponse(),
};

const exit: Command = {
  name: "exit",
  description: "Quit sydcli",
  run: (_args, ctx) => ctx.exit(),
};

export const commands: Record<string, Command> = {
  help: help,
  new: newChat,
  resume: resume,
  rename: rename,
  model: model,
  provider: provider,
  copy: copy,
  exit: exit,
  quit: exit,
};

// Unique commands for the suggestion palette — the `commands` record maps
// several keys to the same object (e.g. quit → exit), so dedupe by reference
// to avoid showing an alias as its own entry. Insertion order is preserved.
export const commandList: Command[] = [...new Set(Object.values(commands))];

export function dispatch(input: string, ctx: CommandContext) {
  if (!input.startsWith("/")) return false;

  const [name, ...rest] = input.slice(1).split(" ");
  const args = rest.join(" ");
  const command = commands[name];

  if (!command) {
    ctx.addSystemMessage(`unknown command: /${name}`);
    return true;
  }

  command.run(args, ctx);
  return true;
}
