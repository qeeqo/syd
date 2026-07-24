import { useState } from "react";

type chatInputBoxProps = {
  title: string;
  model: string;
  onSubmit: (message: string) => void;
};

export default function ChatInputBox({
  title,
  model,
  onSubmit,
}: chatInputBoxProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    const message = draft.trim();

    if (!message) {
      return;
    }

    onSubmit(message);
    setDraft("");
  }
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={0}>
      <box
        border={["top", "bottom"]}
        borderColor="#4f8cff"
        title={` ${title} `}
        titleAlignment="right"
        titleColor="#8bb4ff"
        flexDirection="column"
      >
        <input
          value={draft}
          placeholder="Ask syd anything..."
          focused
          onInput={setDraft}
          onSubmit={handleSubmit}
        />
      </box>
      <box alignItems="flex-end">
        <text fg="#8bb4ff">⋅{model}</text>
      </box>
    </box>
  );
}
