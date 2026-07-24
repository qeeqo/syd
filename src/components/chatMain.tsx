import { useState } from "react";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import type { Message } from "../commands/type";
import { SYD_TAGLINE } from "../branding.ts";

type ChatMainProps = { messages: Message[]; streaming: boolean };

export default function ChatMain({ messages, streaming }: ChatMainProps) {
  // One shared syntax theme for all rendered markdown. Created lazily on first
  // render (after the renderer's native lib is up) via a useState initializer
  // so it's built exactly once and reused for the app's lifetime — cheaper than
  // one per message and satisfies <markdown>'s required syntaxStyle prop.
  const [syntaxStyle] = useState(() => SyntaxStyle.create());

  return (
    <box flexDirection="column" padding={1} width="100%" flexGrow={1}>
      <box
        title=" sydcli "
        titleColor="#8bb4ff"
        flexDirection="column"
        flexGrow={1}
      >
        {messages.length === 0 ? (
          // Empty session: center the wordmark on both axes in the whole area.
          <SydBanner />
        ) : (
          /*
            A scrollbox clips its content to the viewport and scrolls instead of
            overflowing onto the input box / command popup below it. stickyScroll
            keeps the latest output pinned to the bottom while streaming, but
            releases once the user scrolls up to read earlier messages.
          */
          <scrollbox
            flexGrow={1}
            scrollY
            stickyScroll
            stickyStart="bottom"
            paddingX={2}
            paddingY={1}
            verticalScrollbarOptions={{ visible: false }}
            contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
          >
            {messages.map((m, i) => (
              <MessageBlock
                key={i}
                message={m}
                syntaxStyle={syntaxStyle}
                streaming={streaming && i === messages.length - 1}
              />
            ))}
          </scrollbox>
        )}
      </box>
    </box>
  );
}

// New-session greeting: the syd wordmark shown while the chat is empty.
// Fills the whole chat area and centers the mark on both axes. Uses OpenTUI's
// built-in <ascii-font> big-font renderer (Unicode block glyphs + a color
// gradient) instead of a hand-drawn banner.
function SydBanner() {
  return (
    <box
      flexGrow={1}
      width="100%"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      {/* block font is uppercase-only — lowercase renders blank */}
      <ascii-font text="SYD" font="block" color={["#8bb4ff", "#4f8cff"]} />
      <text fg="#5b6472" marginTop={1}>
        {SYD_TAGLINE}
      </text>
    </box>
  );
}

type MessageBlockProps = {
  message: Message;
  syntaxStyle: SyntaxStyle;
  // True only while this specific turn is actively receiving streamed tokens.
  streaming: boolean;
};

function MessageBlock({ message, syntaxStyle, streaming }: MessageBlockProps) {
  // System notices stay compact — a single dim line, no header.
  if (message.role === "system") {
    return (
      <text fg="#6b7280" wrapMode="word">
        · {message.content}
      </text>
    );
  }

  // Assistant output is markdown from the model — parse & style it so headings,
  // lists, bold, and code blocks render visually instead of showing raw
  // `**`/`#`/backtick syntax. `streaming` keeps the trailing block flexible
  // while tokens arrive, then flips false so trailing-token parsing finalizes.
  if (message.role === "assistant") {
    return (
      <box flexDirection="column" width="100%">
        <text fg="#8bb4ff" attributes={TextAttributes.BOLD}>
          syd
        </text>
        <markdown
          content={message.content}
          syntaxStyle={syntaxStyle}
          fg="#dfe8ff"
          streaming={streaming}
          width="100%"
        />
      </box>
    );
  }

  // User turns are shown verbatim — no markdown parsing on what they typed.
  return (
    <box flexDirection="column" width="100%">
      <text fg="#4f8cff" attributes={TextAttributes.BOLD}>
        {">"}
      </text>
      <text fg="#f3f6ff" wrapMode="word">
        {message.content}
      </text>
    </box>
  );
}
