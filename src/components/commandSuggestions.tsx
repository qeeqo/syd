import type { Command } from "../commands/type";

type CommandSuggestionsProps = {
  items: Command[];
  selectedIndex: number;
};

// Cap how tall the popup can get. With more items than this we window the
// list around the selection so it stays compact and scrolls as you arrow.
const MAX_VISIBLE = 6;

export default function CommandSuggestions({
  items,
  selectedIndex,
}: CommandSuggestionsProps) {
  const total = items.length;

  // Window start: keep the selected row visible, biased toward the middle.
  const start =
    total <= MAX_VISIBLE
      ? 0
      : Math.min(
          Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE / 2)),
          total - MAX_VISIBLE,
        );
  const visible = items.slice(start, start + MAX_VISIBLE);

  // Align descriptions into a column by padding names to the widest name.
  const nameWidth = items.reduce((w, c) => Math.max(w, c.name.length), 0);

  const hiddenAbove = start;
  const hiddenBelow = total - (start + visible.length);

  return (
    <box
      border
      borderColor="#2a3350"
      backgroundColor="#141824"
      flexDirection="column"
      alignSelf="flex-start"
      flexShrink={0}
      marginBottom={0}
    >
      {hiddenAbove > 0 && <text fg="#4b5674"> ↑ {hiddenAbove} more</text>}
      {visible.map((cmd, i) => {
        const selected = start + i === selectedIndex;
        return (
          <box
            key={cmd.name}
            paddingX={1}
            flexDirection="row"
            backgroundColor={selected ? "#233056" : undefined}
          >
            <text fg={selected ? "#cfe0ff" : "#8bb4ff"}>
              /{cmd.name.padEnd(nameWidth, " ")}
            </text>
            <text fg={selected ? "#9fb2d8" : "#6b7280"}>
              {"  "}
              {cmd.description}
            </text>
          </box>
        );
      })}
      {hiddenBelow > 0 && <text fg="#4b5674"> ↓ {hiddenBelow} more</text>}
      <text fg="#3d4761">
        {" "}
        ↑↓ navigate · ↵ run · tab complete · esc dismiss
      </text>
    </box>
  );
}
