import { useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "./themeContext";
import "./overlayBox";

export type McpToolView = { name: string; description: string };

export type McpServerView = {
  name: string;
  where: string;
  trust: string;
  connected: boolean;
  tools: McpToolView[];
};

type McpToolsPopupProps = {
  servers: McpServerView[];
  onDismiss: () => void;
};

const STEP = 2;
const PAGE = 12;
const MAX_VISIBLE = 8;

export default function McpToolsPopup({
  servers,
  onDismiss,
}: McpToolsPopupProps) {
  const t = useTheme();
  const [mode, setMode] = useState<"list" | "detail">("list");
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
    <overlay-box
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
        {mode === "list" ? "↵ open · esc close" : "PgUp/PgDn page · ←/esc back"}
      </text>
    </overlay-box>
  );
}

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

  // Capped so one long name can't blow the popup out to full width.
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
            <text fg={server.connected ? t.success : t.dangerDim}>
              {status}
            </text>
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg={t.textFaint}> ↓ {hiddenBelow} more</text>}
    </box>
  );
}

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
