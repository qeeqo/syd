import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "./themeContext";
import "./overlayBox";

type SettingBase = {
  key: string;
  label: string;
  description: string;
};

export type SettingItem =
  | (SettingBase & { kind: "toggle"; value: boolean })
  | (SettingBase & {
      kind: "choice";
      value: string;
      options: readonly string[];
    });

type SettingsPopupProps = {
  items: SettingItem[];
  onToggle: (key: string) => void;
  onDismiss: () => void;
};

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

  const labelWidth = items.reduce((w, it) => Math.max(w, it.label.length), 0);

  return (
    <overlay-box
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
              {item.kind === "toggle" ? (
                <text
                  fg={item.value ? t.success : t.dangerDim}
                  attributes={TextAttributes.BOLD}
                >
                  {item.value ? "on" : "off"}
                </text>
              ) : (
                <text
                  fg={item.value === item.options[0] ? t.textMuted : t.info}
                  attributes={TextAttributes.BOLD}
                >
                  {item.value}
                </text>
              )}
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
        ↵ change · esc close
      </text>
    </overlay-box>
  );
}
