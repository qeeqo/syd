import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Session } from "../session";

type SessionPickerProps = {
  sessions: Session[];
  onSelect: (session: Session) => void;
  onDismiss: () => void;
};

// Same cap as CommandSuggestions: window the list around the selection so a
// long history scrolls instead of growing the popup.
const MAX_VISIBLE = 8;

// Human-readable "how long ago" for each session row.
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
  const [selected, setSelected] = useState(0);
  const total = sessions.length;

  // The picker owns navigation; App owns what happens on select/dismiss.
  // preventDefault keeps these keys away from the (unfocused) input below.
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

  // Window start: keep the selected row visible, biased toward the middle.
  const start =
    total <= MAX_VISIBLE
      ? 0
      : Math.min(
          Math.max(0, selected - Math.floor(MAX_VISIBLE / 2)),
          total - MAX_VISIBLE,
        );
  const visible = sessions.slice(start, start + MAX_VISIBLE);

  // Align columns: pad titles to the widest (capped so one long title
  // doesn't blow the popup out to full width).
  const titleWidth = Math.min(
    sessions.reduce((w, s) => Math.max(w, s.title.length), 0),
    32,
  );

  const hiddenAbove = start;
  const hiddenBelow = total - (start + visible.length);

  return (
    <box
      border
      borderColor="#2a3350"
      backgroundColor="#141824"
      title=" resume session "
      titleColor="#8bb4ff"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {hiddenAbove > 0 && <text fg="#4b5674"> ↑ {hiddenAbove} more</text>}
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
            backgroundColor={isSelected ? "#233056" : undefined}
          >
            <text fg={isSelected ? "#9fb2d8" : "#4b5674"}>
              {session.id.slice(0, 8)}
              {"  "}
            </text>
            <text fg={isSelected ? "#cfe0ff" : "#8bb4ff"}>{title}</text>
            <text fg={isSelected ? "#9fb2d8" : "#6b7280"}>
              {"  "}
              {formatAge(session.updatedAt)}
            </text>
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg="#4b5674"> ↓ {hiddenBelow} more</text>}
      {/* <text fg="#3d4761" marginTop={1}> */}
      {/*   {" "} */}
      {/*   ↑↓ navigate · ↵ resume · esc dismiss */}
      {/* </text> */}
    </box>
  );
}
