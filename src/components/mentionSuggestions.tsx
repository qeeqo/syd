import type { Skill } from "../skills";
import { useTheme } from "./themeContext";

type MentionSuggestionsProps = {
  items: Skill[];
  selectedIndex: number;
};

// Window the list around the selection past this, mirroring CommandSuggestions.
const MAX_VISIBLE = 6;

// So the palette can show @name plus a hint, and you can tell skills apart
// without opening /skills.
function hint(skill: Skill): string {
  const firstLine = skill.instructions.split("\n", 1)[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
}

// Purely presentational: chatInputBox owns the selection, keys, and completion.
export default function MentionSuggestions({
  items,
  selectedIndex,
}: MentionSuggestionsProps) {
  const t = useTheme();
  const total = items.length;

  const start = Math.max(0, selectedIndex - (MAX_VISIBLE - 1));
  const visible = items.slice(start, start + MAX_VISIBLE);

  // Align hints into a column.
  const nameWidth = items.reduce((w, s) => Math.max(w, s.name.length), 0);

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
      {visible.map((skill, i) => {
        const selected = start + i === selectedIndex;
        const h = hint(skill);
        return (
          <box
            key={skill.name}
            paddingX={1}
            flexDirection="row"
            backgroundColor={selected ? t.selectionBg : undefined}
          >
            <text fg={selected ? t.textSelected : t.accent}>
              @{skill.name.padEnd(nameWidth, " ")}
            </text>
            {h.length > 0 && (
              <text fg={selected ? t.textSecondary : t.textMuted}>
                {"  "}
                {h}
              </text>
            )}
          </box>
        );
      })}
      {/* Constant height so the box doesn't jump while scrolling. */}
      {total > MAX_VISIBLE && (
        <text fg={t.textFaint}>
          {hiddenBelow > 0 ? ` ↓ ${hiddenBelow} more` : " "}
        </text>
      )}
      <text fg={t.textHint} marginTop={1}>
        {" "}
        ↑↓ navigate · ↵/tab insert · esc dismiss
      </text>
    </box>
  );
}
