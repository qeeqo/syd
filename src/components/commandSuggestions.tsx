import type { Command } from "../commands/type";
import { useTheme } from "./themeContext";

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
  const t = useTheme();
  const total = items.length;

  // Window start: only scroll once the selection would fall past the last
  // visible row. Until then the window stays at 0, so the popup's contents
  // don't shift while arrowing through the first page.
  const start = Math.max(0, selectedIndex - (MAX_VISIBLE - 1));
  const visible = items.slice(start, start + MAX_VISIBLE);

  // Align descriptions into a column by padding names to the widest name.
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
      {/* Always occupy this row while the list overflows, even at "0 more" —
          a conditional row would change the popup height mid-scroll and make
          the whole box jump. Blank keeps the height constant. */}
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
