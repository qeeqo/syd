import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AskUserRequest } from "../tools";

type AskUserPopupProps = {
  request: AskUserRequest;
  // Resolve the paused turn with the chosen/typed answer.
  onAnswer: (answer: string) => void;
  // Dismiss without answering — App resolves the tool with a "dismissed" note
  // so the model can proceed instead of hanging.
  onDismiss: () => void;
};

// The generic "syd asks you" popup: the model calls the askUser tool with a
// question and options, this renders them, and the user's choice flows back as
// the tool's result. A reusable interaction primitive — syd decides the content
// at runtime, so this component only knows how to present a question, never what
// it's for. Options are a highlightable list (↑↓/↵); when the tool set
// allowInput, a final "type your own" row focuses a free-text field.
export default function AskUserPopup({
  request,
  onAnswer,
  onDismiss,
}: AskUserPopupProps) {
  const { question, options, allowInput } = request;
  // The custom-answer row (when allowed) sits just past the last option.
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
        // On an option row, resolve with that option. On the custom row, let
        // the focused input's onSubmit handle it (don't preventDefault), so the
        // typed text — not the row — is what gets submitted.
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
      borderColor="#2a4a5a"
      backgroundColor="#141824"
      title=" syd asks "
      titleColor="#77c7e8"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      <text fg="#dfe8ff" wrapMode="word">
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
              backgroundColor={isSelected ? "#233056" : undefined}
            >
              <text fg={isSelected ? "#cfe0ff" : "#8bb4ff"}>
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
            backgroundColor={onCustomRow ? "#233056" : undefined}
          >
            <text fg={onCustomRow ? "#cfe0ff" : "#8bb4ff"}>
              {onCustomRow ? "› " : "  "}
              type your own answer
            </text>
            {/* Focused only while its row is selected, so option navigation
                and free-text entry never fight over the keyboard. */}
            <box flexDirection="row" paddingLeft={2}>
              <text fg="#5b6472">❯ </text>
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

      <text fg="#5b6472" marginTop={1}>
        {onCustomRow
          ? "type an answer · ↵ send · ↑↓ back to options · esc dismiss"
          : "↑↓ select · ↵ choose · esc dismiss"}
      </text>
    </box>
  );
}
