import { useState } from "react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import { dispatch } from "./commands/registry";
import type { CommandContext, Message } from "./commands/type";

export default function App() {
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [model, setModel] = useState("gemini-2.0-flash");

  const ctx: CommandContext = {
    addSystemMessage: (text) =>
      setMessages((prev) => [...prev, { role: "system", content: text }]),
    newSession: () => {
      setSessionTitle("New Chat");
      setMessages([]);
    },
    setSessionTitle,
    setModel: (next) => {
      setModel(next);
      ctx.addSystemMessage(`model set to ${next}`);
    },
    exit: () => process.exit(0),
  };

  function handleSubmit(message: string) {
    if (dispatch(message, ctx)) return;
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#0f1117"
    >
      <ChatMain />
      <ChatInputBox
        title={sessionTitle}
        model={model}
        onSubmit={handleSubmit}
      />
    </box>
  );
}
