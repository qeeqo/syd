import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { REASONING_LEVELS, type ReasoningLevel } from "../reasoning.ts";
import { useTheme } from "./themeContext.tsx";

type ReasoningPickerProps = {
  // Marks the ● row and is what Escape reverts to.
  current: ReasoningLevel;
  onSelect: (level: ReasoningLevel) => void;
  onDismiss: () => void;
  // Set when opened with ^r from the model picker, so the footer can say where
  // esc/↵ will land.
  returnsToModels?: boolean;
  // Supplied by the caller rather than written here: the only descriptions
  // worth showing are the ones the provider publishes for the active model. A
  // level it says nothing about gets no line — better an honest blank than syd
  // inventing a characterisation it can't vouch for. Partial by nature: no
  // provider describes "default" or "off".
  descriptions?: Partial<Record<ReasoningLevel, string>>;
};

export default function ReasoningPicker({
  current,
  onSelect,
  onDismiss,
  returnsToModels = false,
  descriptions,
}: ReasoningPickerProps) {
  const t = useTheme();
  const total = REASONING_LEVELS.length;
  const [selected, setSelected] = useState(() =>
    Math.max(0, REASONING_LEVELS.indexOf(current)),
  );

  const step = (delta: number) =>
    setSelected((i) => (i + delta + total) % total);

  useKeyboard((key) => {
    switch (key.name) {
      case "up":
        key.preventDefault();
        step(-1);
        break;
      case "down":
        key.preventDefault();
        step(1);
        break;
      case "return":
        key.preventDefault();
        onSelect(REASONING_LEVELS[selected]);
        break;
      case "escape":
      case "q":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  const labelWidth = REASONING_LEVELS.reduce(
    (w, level) => Math.max(w, level.length),
    0,
  );

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" thinking "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="70%"
      maxWidth={72}
    >
      {REASONING_LEVELS.map((level, i) => {
        const isSelected = i === selected;
        return (
          <box
            key={level}
            flexDirection="row"
            paddingX={1}
            gap={1}
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            {/* flexShrink={0}: the label is the row's identity and must never
                be the thing that gives way. Without it a narrow terminal
                squeezes it until it wraps, which both re-heights the row and
                orphans the ● marker onto its own line. */}
            <text
              fg={isSelected ? t.textSelected : t.accent}
              flexShrink={0}
              wrapMode="none"
            >
              {level === current ? "● " : "  "}
              {level.padEnd(labelWidth, " ")}
            </text>
            {/* Beside the label, not under it. A description that appears only
                on the highlighted row makes the popup grow and shrink as you
                move through it, so every row shifts under the cursor; inline,
                each row is exactly one line whatever is selected. It also shows
                every level's wording at once instead of one at a time.
                wrapMode="none" is what holds that line count at one — a wrap
                would put the jumping right back. */}
            {descriptions?.[level] && (
              <text
                fg={t.textMuted}
                wrapMode="none"
                flexGrow={1}
                flexShrink={1}
              >
                {descriptions[level]}
              </text>
            )}
          </box>
        );
      })}

      <text fg={t.textDim} marginTop={1}>
        ↑↓ move · ↵ apply ·{" "}
        {returnsToModels ? "esc back to models" : "esc cancel"}
      </text>
    </box>
  );
}
