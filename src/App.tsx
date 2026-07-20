import { useState } from "react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import { dispatch } from "./commands/registry";
import type { CommandContext } from "./commands/type";

export default function App() {
  const [sessionTitle, setSessionTitle] = useState("New Chat");

  const ctx: CommandContext = {
    addSystemMessage: (_text) => {},
    newSession: () => {
      setSessionTitle("New Chat"); // build an automatic title from converstation
    },
    setSessionTitle,
    setModel: (_model) => {},
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
      <ChatInputBox title={sessionTitle} onSubmit={handleSubmit} />
    </box>
  );
}
