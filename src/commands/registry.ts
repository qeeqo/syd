import type { Command, CommandContext } from "./type.ts";

const help: Command = {
  name: "help",
  description: "Show all available commands",
  run: (_args, ctx) => ctx.showHelp(),
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
  description: "Pick a model (live list), or switch directly by name",
  // No arg → open the picker (live models for the current provider); an arg
  // → switch directly, which stays scriptable and works offline.
  run: (args, ctx) => ctx.setModel(args.trim() || undefined),
};

const provider: Command = {
  name: "provider",
  description: "Switch AI provider (google, anthropic, openai, openai-chatgpt)",
  run: (args, ctx) => ctx.setProvider(args.trim() || undefined),
};

const copy: Command = {
  name: "copy",
  description: "Copy the latest response to the clipboard",
  run: (_args, ctx) => ctx.copyLastResponse(),
};

const auto: Command = {
  name: "auto",
  description: "Toggle auto-approve of file edits (/auto on|off to set)",
  // Bare `/auto` flips the mode; an explicit on/off is scriptable and
  // unambiguous. Anything else is a usage nudge rather than a silent no-op.
  run: (args, ctx) => {
    const arg = args.trim().toLowerCase();
    if (!arg) return ctx.toggleAutoApprove();
    if (arg === "on" || arg === "off") return ctx.setAutoApprove(arg === "on");
    ctx.addSystemMessage("usage: /auto [on|off]");
  },
};

const settings: Command = {
  name: "settings",
  description: "Toggle settings (shell commands, auto-approve)",
  run: (_args, ctx) => ctx.showSettings(),
};

const skills: Command = {
  name: "skills",
  description: "Manage skills — saved instructions you invoke with @name",
  run: (_args, ctx) => ctx.showSkills(),
};

const mcp: Command = {
  name: "mcp",
  description: "Browse tools from connected MCP servers",
  run: (_args, ctx) => ctx.showMcpTools(),
};

const mcpReload: Command = {
  name: "mcp-reload",
  description: "Reconnect all MCP servers (after editing config)",
  run: (_args, ctx) => ctx.reloadMcp(),
};

const mcpLogin: Command = {
  name: "mcp-login",
  description: "Sign in to an OAuth MCP server: /mcp-login <server>",
  run: (args, ctx) => {
    const server = args.trim();
    if (!server) {
      ctx.addSystemMessage("usage: /mcp-login <server>");
      return;
    }
    return ctx.loginMcp(server);
  },
};

const mcpAdd: Command = {
  name: "mcp-add",
  description: "Add an HTTP server: /mcp-add <name> <url> [oauth]",
  run: (args, ctx) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const [name, url, flag] = parts;
    if (!name || !url) {
      ctx.addSystemMessage("usage: /mcp-add <name> <url> [oauth]");
      return;
    }
    if (flag !== undefined && flag !== "oauth") {
      ctx.addSystemMessage('the third argument must be "oauth" or omitted');
      return;
    }
    return ctx.addMcpServer(name, url, flag === "oauth");
  },
};

const mcpRemove: Command = {
  name: "mcp-remove",
  description: "Remove a server: /mcp-remove <name>",
  run: (args, ctx) => {
    const name = args.trim();
    if (!name) {
      ctx.addSystemMessage("usage: /mcp-remove <name>");
      return;
    }
    return ctx.removeMcpServer(name);
  },
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
  auto: auto,
  settings: settings,
  skills: skills,
  mcp: mcp,
  "mcp-reload": mcpReload,
  "mcp-login": mcpLogin,
  "mcp-add": mcpAdd,
  "mcp-remove": mcpRemove,
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
