import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";
import { useTheme } from "./themeContext";

type HelpPopupProps = {
  onDismiss: () => void;
};

export default function HelpPopup({ onDismiss }: HelpPopupProps) {
  const t = useTheme();
  // Informational only — any of the obvious "close" keys dismisses it.
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") {
      key.preventDefault();
      onDismiss();
    }
  });

  const nameWidth = commandList.reduce((w, c) => Math.max(w, c.name.length), 0);

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" commands "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {commandList.map((cmd) => (
        <box key={cmd.name} paddingX={1} flexDirection="row">
          <text fg={t.accent}>/{cmd.name.padEnd(nameWidth, " ")}</text>
          <text fg={t.textMuted}>
            {"  "}
            {cmd.description}
          </text>
        </box>
      ))}
    </box>
  );
}
