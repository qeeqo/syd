import type { Skill } from "../skills";
import { useTheme } from "./themeContext";
import "./overlayBox";

type MentionSuggestionsProps = {
  items: Skill[];
  selectedIndex: number;
};

const MAX_VISIBLE = 6;

function hint(skill: Skill): string {
  const firstLine = skill.instructions.split("\n", 1)[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
}

export default function MentionSuggestions({
  items,
  selectedIndex,
}: MentionSuggestionsProps) {
  const t = useTheme();
  const total = items.length;
  const start = Math.max(0, selectedIndex - (MAX_VISIBLE - 1));
  const visible = items.slice(start, start + MAX_VISIBLE);
  const nameWidth = items.reduce((w, s) => Math.max(w, s.name.length), 0);
  const hiddenBelow = total - (start + visible.length);

  return (
    <overlay-box
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
        ↵/tab insert · esc dismiss
      </text>
    </overlay-box>
  );
}
