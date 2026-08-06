import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { themeList } from "../theme.ts";
import { useTheme } from "./themeContext.tsx";

type ThemePickerProps = {
  // Marks the ● row and is what Escape reverts to.
  current: string;
  // Live preview as the highlight moves — App applies without persisting.
  onHighlight: (name: string) => void;
  onSelect: (name: string) => void;
  // App restores `current`, undoing any live preview.
  onDismiss: () => void;
};

// Its own chrome reads from useTheme(), so it recolors as you preview.
export default function ThemePicker({
  current,
  onHighlight,
  onSelect,
  onDismiss,
}: ThemePickerProps) {
  const t = useTheme();
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      themeList.findIndex((th) => th.name === current),
    ),
  );
  const total = themeList.length;

  function move(next: number) {
    setSelected(next);
    onHighlight(themeList[next].name);
  }

  useKeyboard((key) => {
    switch (key.name) {
      case "up":
        key.preventDefault();
        move((selected - 1 + total) % total);
        break;
      case "down":
        key.preventDefault();
        move((selected + 1) % total);
        break;
      case "return":
        key.preventDefault();
        onSelect(themeList[selected].name);
        break;
      case "escape":
      case "q":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  const labelWidth = themeList.reduce((w, th) => Math.max(w, th.label.length), 0);

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" theme "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="70%"
      maxWidth={72}
    >
      {themeList.map((th, i) => {
        const isSelected = i === selected;
        return (
          <box
            key={th.name}
            flexDirection="column"
            paddingX={1}
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            {/* padEnd keeps the selection band the same width on every row —
                the box is content-sized, so without it the highlight would
                ragged-edge along the label lengths. */}
            <text fg={isSelected ? t.textSelected : t.accent}>
              {th.name === current ? "● " : "  "}
              {th.label.padEnd(labelWidth, " ")}
            </text>
          </box>
        );
      })}

      <text fg={t.textDim} marginTop={1}>
        esc cancel
      </text>
    </box>
  );
}
