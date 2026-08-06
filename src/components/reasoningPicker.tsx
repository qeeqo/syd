import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { REASONING_LEVELS, type ReasoningLevel } from "../reasoning.ts";
import { useTheme } from "./themeContext.tsx";
import "./overlayBox";

type ReasoningPickerProps = {
  current: ReasoningLevel;
  onSelect: (level: ReasoningLevel) => void;
  onDismiss: () => void;
  returnsToModels?: boolean;
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
    <overlay-box
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
            <text
              fg={isSelected ? t.textSelected : t.accent}
              flexShrink={0}
              wrapMode="none"
            >
              {level === current ? "● " : "  "}
              {level.padEnd(labelWidth, " ")}
            </text>
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
        {returnsToModels ? "esc back to models" : "esc cancel"}
      </text>
    </overlay-box>
  );
}
