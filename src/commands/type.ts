// A tool-activity notice shown inline in the transcript ("↳ edited x.ts"),
// optionally with a unified diff rendered as red/green highlighted lines.
export type ToolNote = {
  label: string;
  // Unified-diff text (---/+++/@@ format) — the shape OpenTUI's <diff>
  // renderable parses natively.
  diffText?: string;
};

// How a plain system notice reads. It drives only the colour of the gutter rule
// drawn beside the message — never the text — so a transcript full of notices
// stays quiet while a failure is still findable at a glance.
//
// Set explicitly at each call site rather than sniffed from the message text: a
// substring check like content.includes("failed") is a heuristic that silently
// mislabels ("no response to copy yet" is not an error, "removed X" is not a
// success), and the caller always knows which of the three it meant.
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
  // Present only on system messages that record tool activity; drives the
  // special ↳/diff rendering instead of the plain gutter-rule system line.
  toolNote?: ToolNote;
  // Only meaningful on a system message without a toolNote. Absent reads as
  // "note" — the neutral grey rule.
  tone?: SystemTone;
};

export type CommandContext = {
  // `tone` colours the gutter rule beside the notice; omit it for an ordinary
  // confirmation or progress note.
  addSystemMessage: (text: string, tone?: SystemTone) => void;
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
  // Open the theme picker. Highlighting a theme previews it live; selecting one
  // persists it to config.json. No restart required.
  showTheme: () => void;
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
