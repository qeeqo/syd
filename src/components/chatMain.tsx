import type { Message } from "../commands/type";

type ChatMainProps = { messages: Message[] };

export default function ChatMain({ messages }: ChatMainProps) {
  return (
    <box flexDirection="column" gap={1} padding={1} width="100%" flexGrow={1}>
      <box
        title=" sydcli "
        titleColor="#8bb4ff"
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        flexGrow={1}
      >
        {messages.length === 0 ? (
          <text fg="#f3f6ff">Hello Leo, this is sydcli.</text>
        ) : (
          messages.map((m, i) => (
            <text key={i} fg={colorFor(m.role)}>
              {prefixFor(m.role)}
              {m.content}
            </text>
          ))
        )}
      </box>
    </box>
  );
}

function colorFor(role: Message["role"]) {
  if (role === "assistant") return "#8bb4ff";
  if (role === "system") return "#6b7280";
  return "#f3f6ff";
}

function prefixFor(role: Message["role"]) {
  if (role === "user") return "> ";
  if (role === "system") return "· ";
  return "";
}
