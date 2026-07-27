// A tool-activity notice shown inline in the transcript ("↳ edited x.ts"),
// optionally with a unified diff rendered as red/green highlighted lines.
export type ToolNote = {
  label: string;
  // Unified-diff text (---/+++/@@ format) — the shape OpenTUI's <diff>
  // renderable parses natively.
  diffText?: string;
};

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  // Present only on system messages that record tool activity; drives the
  // special ↳/diff rendering instead of the plain dim system line.
  toolNote?: ToolNote;
};

export type CommandContext = {
  addSystemMessage: (text: string) => void;
  newSession: () => void;
  // No id → list resumable sessions; id (or unique prefix) → resume that one.
  resumeSession: (id?: string) => void | Promise<void>;
  setSessionTitle: (title: string) => void;
  // No name → open the model picker for the current provider; name → switch
  // directly to that model.
  setModel: (model?: string) => void;
  // No id → open the provider picker; id → switch directly (if key is set).
  setProvider: (id?: string) => void;
  // Copy the most recent assistant response to the system clipboard.
  copyLastResponse: () => void | Promise<void>;
  // Set file-edit approval to auto (apply without asking) or manual (default:
  // confirm each write). Explicit form for `/auto on|off`.
  setAutoApprove: (auto: boolean) => void;
  // Flip the current approval mode — backs the bare `/auto` toggle.
  toggleAutoApprove: () => void;
  // Open the command-reference popup.
  showHelp: () => void;
  // Open the settings popup (toggle shell access, auto-approve). Each toggle
  // persists to config.json.
  showSettings: () => void;
  // Open the skills manager popup (create / edit / delete @-invoked skills).
  // Each change persists to config.json.
  showSkills: () => void;
  // Open the scrollable MCP-tools reference window (every connected server's
  // tools + descriptions). No-op with a system note when none are configured.
  showMcpTools: () => void;
  // Re-read config.json and reconnect all MCP servers without restarting syd.
  reloadMcp: () => void | Promise<void>;
  // Run the interactive OAuth login for one configured server, then reconnect.
  loginMcp: (server: string) => void | Promise<void>;
  // Add an HTTP MCP server to config.json and connect it. `oauth` marks it as
  // needing an interactive login (/mcp-login) rather than a static token.
  addMcpServer: (name: string, url: string, oauth: boolean) => void | Promise<void>;
  // Remove a server from config.json and drop its connection.
  removeMcpServer: (name: string) => void | Promise<void>;
  exit: () => void;
};

export type Command = {
  name: string;
  description: string;
  run: (args: string, ctx: CommandContext) => void | Promise<void>;
};
