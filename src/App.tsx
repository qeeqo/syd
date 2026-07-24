import { useRef, useState } from "react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import { dispatch } from "./commands/registry";
import { streamChat } from "./chat";
import { createSession, listSessions, saveSession } from "./session";
import type { Session } from "./session";
import type { CommandContext, Message } from "./commands/type";

export default function App() {
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [model, setModel] = useState("gemini-3.6-flash");
  // True only while a model response is actively streaming. Drives the
  // markdown renderer's `streaming` mode on the in-flight assistant turn so it
  // finalizes trailing-token parsing once the turn completes.
  const [isStreaming, setIsStreaming] = useState(false);

  // Stable per-session metadata (id, cwd, createdAt) that must survive
  // re-renders without triggering them. Lazily created on first render.
  const metaRef = useRef<Session | null>(null);
  metaRef.current ??= createSession(model);

  // Assemble the current durable Session from live state + stable metadata.
  function buildSession(msgs: Message[]): Session {
    const meta = metaRef.current!;
    return {
      id: meta.id,
      title: sessionTitle,
      model,
      messages: msgs,
      cwd: meta.cwd,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
    };
  }

  const ctx: CommandContext = {
    addSystemMessage: (text) =>
      setMessages((prev) => [...prev, { role: "system", content: text }]),
    newSession: () => {
      setSessionTitle("New Chat");
      setMessages([]);
      // New conversation → new id/timestamps, so it saves to a fresh file.
      metaRef.current = createSession(model);
    },
    resumeSession: async () => {
      // Hybrid model: most recent session started in THIS directory.
      const [latest] = await listSessions(process.cwd());
      if (!latest) {
        ctx.addSystemMessage("no sessions to resume in this directory");
        return;
      }
      setSessionTitle(latest.title);
      setModel(latest.model); // raw setter — resume shouldn't echo "model set to"
      setMessages(latest.messages);
      // Adopt the loaded session's identity so future saves update its file.
      metaRef.current = latest;
      ctx.addSystemMessage(
        `resumed "${latest.title}" (${latest.messages.length} messages)`,
      );
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
    const base = [...messages, userMsg];
    const history = base.filter((m) => m.role !== "system");

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", content: "" },
    ]);

    let assistant = "";
    setIsStreaming(true);
    try {
      await streamChat({
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
        onDelta: (delta) => {
          assistant += delta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + delta },
            ];
          });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`error: ${msg}`);
      return;
    } finally {
      setIsStreaming(false);
    }

    // Turn complete → persist the full transcript once (not per-token).
    const finalMessages: Message[] = [
      ...base,
      { role: "assistant", content: assistant },
    ];
    try {
      await saveSession(buildSession(finalMessages));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`failed to save session: ${msg}`);
    }
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#0f1117"
    >
      <ChatMain messages={messages} streaming={isStreaming} />
      <ChatInputBox
        title={sessionTitle}
        model={model}
        onSubmit={handleSubmit}
      />
    </box>
  );
}
