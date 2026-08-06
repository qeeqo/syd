import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Session } from "../session";
import { useTheme } from "./themeContext";
import "./overlayBox";

type SessionPickerProps = {
  sessions: Session[];
  onSelect: (session: Session) => void;
  onDismiss: () => void;
};

const MAX_VISIBLE = 8;

function formatAge(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SessionPicker({
  sessions,
  onSelect,
  onDismiss,
}: SessionPickerProps) {
  const t = useTheme();
  const [selected, setSelected] = useState(0);
  const total = sessions.length;

  useKeyboard((key) => {
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
        key.preventDefault();
        onSelect(sessions[selected]);
        break;
      case "escape":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  // Keep the selected row visible, biased toward the middle.
  const start =
    total <= MAX_VISIBLE
      ? 0
      : Math.min(
          Math.max(0, selected - Math.floor(MAX_VISIBLE / 2)),
          total - MAX_VISIBLE,
        );
  const visible = sessions.slice(start, start + MAX_VISIBLE);

  // Capped so one long title doesn't blow the popup out to full width.
  const titleWidth = Math.min(
    sessions.reduce((w, s) => Math.max(w, s.title.length), 0),
    32,
  );

  const hiddenAbove = start;
  const hiddenBelow = total - (start + visible.length);

  return (
    <overlay-box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" resume session "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {hiddenAbove > 0 && <text fg={t.textFaint}> ↑ {hiddenAbove} more</text>}
      {visible.map((session, i) => {
        const isSelected = start + i === selected;
        const title =
          session.title.length > titleWidth
            ? `${session.title.slice(0, titleWidth - 1)}…`
            : session.title.padEnd(titleWidth, " ");
        return (
          <box
            key={session.id}
            paddingX={1}
            flexDirection="row"
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            <text fg={isSelected ? t.textSecondary : t.textFaint}>
              {session.id.slice(0, 8)}
              {"  "}
            </text>
            <text fg={isSelected ? t.textSelected : t.accent}>{title}</text>
            <text fg={isSelected ? t.textSecondary : t.textMuted}>
              {"  "}
              {formatAge(session.updatedAt)}
            </text>
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg={t.textFaint}> ↓ {hiddenBelow} more</text>}
    </overlay-box>
  );
}
