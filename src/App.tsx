import { useState } from "react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import { dispatch } from "./commands/registry";
import { streamChat } from "./chat";
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

  async function handleSubmit(message: string) {
    if (dispatch(message, ctx)) return;

    const userMsg: Message = { role: "user", content: message };
    const history = [...messages, userMsg].filter((m) => m.role !== "system");

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", content: "" },
    ]);

    try {
      await streamChat({
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
        onDelta: (delta) =>
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + delta },
            ];
          }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`error: ${msg}`);
    }
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#0f1117"
    >
      <ChatMain messages={messages} />
      <ChatInputBox
        title={sessionTitle}
        model={model}
        onSubmit={handleSubmit}
      />
    </box>
  );
}
