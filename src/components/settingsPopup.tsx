import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "./themeContext";

// One toggleable preference shown in the /settings window. `value` is the live
// state; App owns it and re-passes a fresh list on every toggle, so this popup
// is fully controlled — it renders whatever App hands it.
export type SettingItem = {
  key: string;
  label: string;
  // A one-line explanation, shown under the row while it's highlighted.
  description: string;
  value: boolean;
};

type SettingsPopupProps = {
  items: SettingItem[];
  // Flip the setting with this key. App updates state AND persists to
  // config.json, then re-renders this popup with the new value.
  onToggle: (key: string) => void;
  onDismiss: () => void;
};

// The /settings window, sibling to /help and /mcp. A short list of on/off
// preferences: ↑↓ moves the highlight, Enter/Space flips the highlighted one
// (its state is shown as the words "on"/"off", not a button), Esc closes.
// Every toggle persists immediately, so the window has no separate "save" step.
export default function SettingsPopup({
  items,
  onToggle,
  onDismiss,
}: SettingsPopupProps) {
  const t = useTheme();
  const [selected, setSelected] = useState(0);
  const total = items.length;

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
      case "space":
        key.preventDefault();
        onToggle(items[selected].key);
        break;
      case "escape":
      case "q":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  // Align the on/off column so the states line up regardless of label length.
  const labelWidth = items.reduce((w, it) => Math.max(w, it.label.length), 0);

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" settings "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      {items.map((item, i) => {
        const isSelected = i === selected;
        return (
          <box
            key={item.key}
            flexDirection="column"
            paddingX={1}
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            <box flexDirection="row">
              <text fg={isSelected ? t.textSelected : t.accent}>
                {item.label.padEnd(labelWidth, " ")}
              </text>
              <text fg={t.textDim}>{"   "}</text>
              <text
                fg={item.value ? t.success : t.dangerDim}
                attributes={TextAttributes.BOLD}
              >
                {item.value ? "on" : "off"}
              </text>
            </box>
            {isSelected && item.description.length > 0 && (
              <text fg={t.textMuted} wrapMode="word">
                {item.description}
              </text>
            )}
          </box>
        );
      })}

      <text fg={t.textDim} marginTop={1}>
        ↑↓ select · ↵ toggle · esc close
      </text>
    </box>
  );
}
