import { useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";

// One tool as shown in the reference window: its (bare, un-namespaced) name and
// the server-authored description. Both come from the connected MCP server.
export type McpToolView = { name: string; description: string };

// One server's section in the window.
export type McpServerView = {
  name: string;
  // Human-readable transport summary, e.g. "http https://…" or "stdio npx".
  where: string;
  trust: string;
  // False when the server is configured but exposed no tools (failed to
  // connect, or genuinely empty).
  connected: boolean;
  tools: McpToolView[];
};

type McpToolsPopupProps = {
  servers: McpServerView[];
  onDismiss: () => void;
};

// How many rows one key-press scrolls. Arrow keys nudge; page keys jump.
const STEP = 2;
const PAGE = 12;

// A read-only, scrollable reference of the tools every connected MCP server
// exposes — the `/mcp` window, sibling to the `/help` popup. Purely
// informational: it never runs a tool, so there's no selection, just scroll.
export default function McpToolsPopup({
  servers,
  onDismiss,
}: McpToolsPopupProps) {
  const boxRef = useRef<ScrollBoxRenderable | null>(null);

  useKeyboard((key) => {
    const box = boxRef.current;
    switch (key.name) {
      case "escape":
      case "return":
      case "q":
        key.preventDefault();
        onDismiss();
        break;
      case "up":
        key.preventDefault();
        box?.scrollBy(-STEP);
        break;
      case "down":
        key.preventDefault();
        box?.scrollBy(STEP);
        break;
      case "pageup":
        key.preventDefault();
        box?.scrollBy(-PAGE);
        break;
      case "pagedown":
      case "space":
        key.preventDefault();
        box?.scrollBy(PAGE);
        break;
      case "home":
        key.preventDefault();
        box?.scrollTo(0);
        break;
      case "end":
        key.preventDefault();
        box?.scrollTo(box.scrollHeight);
        break;
    }
  });

  const totalTools = servers.reduce((n, s) => n + s.tools.length, 0);

  return (
    <box
      border
      borderColor="#2a3350"
      backgroundColor="#141824"
      title=" mcp tools "
      titleColor="#8bb4ff"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      <text fg="#9aa4b2" marginBottom={1}>
        {totalTools} tool{totalTools === 1 ? "" : "s"} across {servers.length}{" "}
        server{servers.length === 1 ? "" : "s"}. Every call still asks for
        approval unless a server is trusted.
      </text>

      <scrollbox
        ref={boxRef}
        scrollY
        maxHeight={18}
        verticalScrollbarOptions={{ visible: true }}
        contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
      >
        {servers.map((server) => (
          <box key={server.name} flexDirection="column" width="100%">
            {/* Server heading + its transport / trust / status. */}
            <text fg="#8bb4ff" attributes={TextAttributes.BOLD}>
              {server.name}
            </text>
            <text fg="#5b6472" wrapMode="word">
              {server.where} · {server.trust}
              {server.connected
                ? ` · ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
                : " · not connected"}
            </text>

            {server.connected && server.tools.length === 0 && (
              <text fg="#6b7280">  (no tools)</text>
            )}

            {server.tools.map((tool) => (
              <box key={tool.name} flexDirection="column" width="100%">
                <text fg="#9fb2d8" attributes={TextAttributes.BOLD}>
                  {"  "}
                  {tool.name}
                </text>
                {tool.description.length > 0 && (
                  <text fg="#6b7280" wrapMode="word">
                    {"    "}
                    {tool.description}
                  </text>
                )}
              </box>
            ))}
          </box>
        ))}
      </scrollbox>

      <text fg="#5b6472" marginTop={1}>
        ↑↓ scroll · PgUp/PgDn page · esc close
      </text>
    </box>
  );
}
