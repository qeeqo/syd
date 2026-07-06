export default function ChatMain() {
  return (
    <box
      flexDirection="column"
      gap={1}
      padding={1}
      width="100%"
      flexGrow={1}
    >
      <box
        title=" sydcli "
        titleColor="#8bb4ff"
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg="#f3f6ff">Hello Leo, this is sydcli.</text>
      </box>
    </box>
  );
}
