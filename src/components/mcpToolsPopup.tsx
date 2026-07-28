import { useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "./themeContext";

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

// How many rows one key-press scrolls in the tool view. Arrows nudge; page keys
// jump. And how many server rows the list view shows before it windows.
const STEP = 2;
const PAGE = 12;
const MAX_VISIBLE = 8;

// The `/mcp` window, sibling to `/help`. Two read-only views so a long list of
// servers doesn't turn into one giant scroll: a server picker (list), and the
// tools of the chosen server (detail). Navigation is bidirectional — Enter
// drills in, Escape/← steps back out (detail → list → closed). Purely
// informational: it never runs a tool, so the detail view only scrolls.
export default function McpToolsPopup({
  servers,
  onDismiss,
}: McpToolsPopupProps) {
  const t = useTheme();
  const [mode, setMode] = useState<"list" | "detail">("list");
  // Highlighted row in the list view; also the server opened in detail view.
  const [selected, setSelected] = useState(0);
  const boxRef = useRef<ScrollBoxRenderable | null>(null);
  const total = servers.length;

  useKeyboard((key) => {
    if (mode === "list") {
      switch (key.name) {
        case "up":
          key.preventDefault();
          setSelected((i) => (i - 1 + total) % total);
          break;
        case "down":
          key.preventDefault();
          setSelected((i) => (i + 1) % total);
          break;
        case "return":
        case "right":
          key.preventDefault();
          setMode("detail");
          break;
        case "escape":
        case "q":
          key.preventDefault();
          onDismiss();
          break;
      }
      return;
    }

    // Detail view: scroll the chosen server's tools, or step back to the list.
    const box = boxRef.current;
    switch (key.name) {
      case "escape":
      case "left":
      case "backspace":
        key.preventDefault();
        setMode("list");
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

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title={mode === "list" ? " mcp servers " : ` ${servers[selected].name} `}
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      {mode === "list" ? (
        <ServerList servers={servers} selected={selected} />
      ) : (
        <ToolList server={servers[selected]} boxRef={boxRef} />
      )}

      <text fg={t.textDim} marginTop={1}>
        {mode === "list"
          ? "↑↓ select · ↵ open · esc close"
          : "↑↓ scroll · PgUp/PgDn page · ←/esc back"}
      </text>
    </box>
  );
}

// The server picker: one highlighted row per server with its transport, trust,
// and connection status. Windowed like SessionPicker so many servers scroll.
function ServerList({
  servers,
  selected,
}: {
  servers: McpServerView[];
  selected: number;
}) {
  const t = useTheme();
  const total = servers.length;
  const totalTools = servers.reduce((n, s) => n + s.tools.length, 0);

  const start =
    total <= MAX_VISIBLE
      ? 0
      : Math.min(
          Math.max(0, selected - Math.floor(MAX_VISIBLE / 2)),
          total - MAX_VISIBLE,
        );
  const visible = servers.slice(start, start + MAX_VISIBLE);
  const hiddenAbove = start;
  const hiddenBelow = total - (start + visible.length);

  // Align the server names into a column, capped so one long name can't blow
  // the popup out to full width.
  const nameWidth = Math.min(
    servers.reduce((w, s) => Math.max(w, s.name.length), 0),
    28,
  );

  return (
    <box flexDirection="column" width="100%">
      <text fg={t.textSecondary} marginBottom={1}>
        {totalTools} tool{totalTools === 1 ? "" : "s"} across {total} server
        {total === 1 ? "" : "s"}. Every call still asks for approval unless a
        server is trusted.
      </text>

      {hiddenAbove > 0 && <text fg={t.textFaint}> ↑ {hiddenAbove} more</text>}
      {visible.map((server, i) => {
        const isSelected = start + i === selected;
        const name =
          server.name.length > nameWidth
            ? `${server.name.slice(0, nameWidth - 1)}…`
            : server.name.padEnd(nameWidth, " ");
        const status = server.connected
          ? `${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
          : "not connected";
        return (
          <box
            key={server.name}
            paddingX={1}
            flexDirection="row"
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            <text fg={isSelected ? t.textSelected : t.accent}>{name}</text>
            <text fg={isSelected ? t.textSecondary : t.textMuted}>
              {"  "}
              {server.where} · {server.trust} ·{" "}
            </text>
            <text fg={server.connected ? t.success : t.dangerDim}>{status}</text>
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg={t.textFaint}> ↓ {hiddenBelow} more</text>}
    </box>
  );
}

// The chosen server's tools, scrollable. Mirrors the old single-server section:
// bare tool name plus the server-authored description.
function ToolList({
  server,
  boxRef,
}: {
  server: McpServerView;
  boxRef: React.RefObject<ScrollBoxRenderable | null>;
}) {
  const t = useTheme();
  return (
    <box flexDirection="column" width="100%">
      <text fg={t.textDim} wrapMode="word" marginBottom={1}>
        {server.where} · {server.trust}
        {server.connected
          ? ` · ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
          : " · not connected"}
      </text>

      {server.tools.length === 0 ? (
        <text fg={t.textMuted}>
          {server.connected
            ? "  (no tools exposed)"
            : "  not connected — run /mcp-login or /mcp-reload"}
        </text>
      ) : (
        <scrollbox
          ref={boxRef}
          scrollY
          maxHeight={18}
          verticalScrollbarOptions={{ visible: true }}
          contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
        >
          {server.tools.map((tool) => (
            <box key={tool.name} flexDirection="column" width="100%">
              <text fg={t.textSecondary} attributes={TextAttributes.BOLD}>
                {tool.name}
              </text>
              {tool.description.length > 0 && (
                <text fg={t.textMuted} wrapMode="word">
                  {"  "}
                  {tool.description}
                </text>
              )}
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}
