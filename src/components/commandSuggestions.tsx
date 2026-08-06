import type { Command } from "../commands/type";
import { useTheme } from "./themeContext";

type CommandSuggestionsProps = {
  items: Command[];
  selectedIndex: number;
};

// Past this the list windows around the selection so the popup stays compact.
const MAX_VISIBLE = 6;

export default function CommandSuggestions({
  items,
  selectedIndex,
}: CommandSuggestionsProps) {
  const t = useTheme();
  const total = items.length;

  // Only scroll once the selection would fall past the last visible row, so
  // the contents don't shift while arrowing through the first page.
  const start = Math.max(0, selectedIndex - (MAX_VISIBLE - 1));
  const visible = items.slice(start, start + MAX_VISIBLE);

  // Align descriptions into a column.
  const nameWidth = items.reduce((w, c) => Math.max(w, c.name.length), 0);

  const hiddenBelow = total - (start + visible.length);

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      flexDirection="column"
      alignSelf="flex-start"
      flexShrink={0}
      marginBottom={0}
    >
      {visible.map((cmd, i) => {
        const selected = start + i === selectedIndex;
        return (
          <box
            key={cmd.name}
            paddingX={1}
            flexDirection="row"
            backgroundColor={selected ? t.selectionBg : undefined}
          >
            <text fg={selected ? t.textSelected : t.accent}>
              /{cmd.name.padEnd(nameWidth, " ")}
            </text>
            <text fg={selected ? t.textSecondary : t.textMuted}>
              {"  "}
              {cmd.description}
            </text>
          </box>
        );
      })}
      {/* Occupied even at "0 more": a conditional row would change the popup
          height mid-scroll and make the whole box jump. */}
      {total > MAX_VISIBLE && (
        <text fg={t.textFaint}>
          {hiddenBelow > 0 ? ` ↓ ${hiddenBelow} more` : " "}
        </text>
      )}
      <text fg={t.textHint} marginTop={1}>
        {" "}
        ↑↓ navigate · ↵ run · tab complete · esc dismiss
      </text>
    </box>
  );
}
