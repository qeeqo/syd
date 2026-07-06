import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";

export default function App() {
  const sessionTitle = "New Chat";
  function handleSubmit() {} // might update for later
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
