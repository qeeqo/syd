import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AskUserRequest } from "../tools";
import { useTheme } from "./themeContext";

type AskUserPopupProps = {
  request: AskUserRequest;
  onAnswer: (answer: string) => void;
  // App resolves the tool with a "dismissed" note so the model proceeds
  // instead of hanging.
  onDismiss: () => void;
};

// A reusable interaction primitive: syd decides the content at runtime, so this
// only knows how to present a question, never what it's for.
export default function AskUserPopup({
  request,
  onAnswer,
  onDismiss,
}: AskUserPopupProps) {
  const t = useTheme();
  const { question, options, allowInput } = request;
  // The custom-answer row sits just past the last option.
  const customIndex = allowInput ? options.length : -1;
  const total = options.length + (allowInput ? 1 : 0);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState("");

  const onCustomRow = selected === customIndex;

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
        // On the custom row, let the focused input's onSubmit handle it (don't
        // preventDefault), so the typed text is what gets submitted.
        if (!onCustomRow) {
          key.preventDefault();
          onAnswer(options[selected]);
        }
        break;
      case "escape":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  function submitCustom() {
    const answer = draft.trim();
    if (answer.length === 0) return; // nothing typed yet — ignore Enter
    onAnswer(answer);
  }

  return (
    <box
      border
      borderColor={t.infoBorder}
      backgroundColor={t.panelBg}
      title=" syd asks "
      titleColor={t.info}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      <text fg={t.text} wrapMode="word">
        {question}
      </text>

      <box flexDirection="column" marginTop={1}>
        {options.map((option, i) => {
          const isSelected = i === selected;
          return (
            <box
              key={`${i}-${option}`}
              paddingX={1}
              flexDirection="row"
              backgroundColor={isSelected ? t.selectionBg : undefined}
            >
              <text fg={isSelected ? t.textSelected : t.accent}>
                {isSelected ? "› " : "  "}
                {option}
              </text>
            </box>
          );
        })}

        {allowInput && (
          <box
            paddingX={1}
            flexDirection="column"
            backgroundColor={onCustomRow ? t.selectionBg : undefined}
          >
            <text fg={onCustomRow ? t.textSelected : t.accent}>
              {onCustomRow ? "› " : "  "}
              type your own answer
            </text>
            {/* Focused only while its row is selected, so option navigation
                and free-text entry never fight over the keyboard. */}
            <box flexDirection="row" paddingLeft={2}>
              <text fg={t.textDim}>❯ </text>
              <input
                value={draft}
                placeholder="…"
                focused={onCustomRow}
                flexGrow={1}
                onInput={setDraft}
                onSubmit={submitCustom}
              />
            </box>
          </box>
        )}
      </box>

      <text fg={t.textDim} marginTop={1}>
        {onCustomRow
          ? "type an answer · ↵ send · ↑↓ back to options · esc dismiss"
          : "↑↓ select · ↵ choose · esc dismiss"}
      </text>
    </box>
  );
}
