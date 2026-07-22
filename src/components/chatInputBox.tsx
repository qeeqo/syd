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
    <box
      border={["top", "bottom"]}
      borderColor="#4f8cff"
      title={` ${title}  ⋅${model} `}
      titleAlignment="right"
      titleColor="#8bb4ff"
      paddingX={1}
      paddingY={1}
      flexDirection="row"
      height={5}
    >
      <box paddingX={1} flexGrow={1} justifyContent="center">
        <input
          value={draft}
          placeholder="Ask syd anything..."
          focused
          onInput={setDraft}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}
