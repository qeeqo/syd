import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";

type HelpPopupProps = {
  onDismiss: () => void;
};

export default function HelpPopup({ onDismiss }: HelpPopupProps) {
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
      borderColor="#2a3350"
      backgroundColor="#141824"
      title=" commands "
      titleColor="#8bb4ff"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {commandList.map((cmd) => (
        <box key={cmd.name} paddingX={1} flexDirection="row">
          <text fg="#8bb4ff">/{cmd.name.padEnd(nameWidth, " ")}</text>
          <text fg="#6b7280">
            {"  "}
            {cmd.description}
          </text>
        </box>
      ))}
    </box>
  );
}
