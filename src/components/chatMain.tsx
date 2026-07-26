import { useEffect, useState } from "react";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import type { Message } from "../commands/type";
import { SYD_TAGLINE } from "../branding.ts";

// The thinking indicator: a seed sprouting into a plant, one frame per tick.
// Grows to full size then restarts from the seed.
const SPROUT_FRAMES = [".", ",", ";", "|", "Y", "ψ"];
const SPROUT_TICK_MS = 260;

function ThinkingSprout() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPROUT_FRAMES.length),
      SPROUT_TICK_MS,
    );
    return () => clearInterval(timer);
  }, []);
  return <text fg="#7ee2a8">{SPROUT_FRAMES[frame]}</text>;
}

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
  if (message.role === "system") {
    // Tool activity: "↳ edited src/x.ts" plus a red/green highlighted diff
    // when the tool changed a file.
    if (message.toolNote) {
      return (
        <box flexDirection="column" width="100%">
          <text fg="#9aa4b2" wrapMode="word">
            ↳ {message.toolNote.label}
          </text>
          {message.toolNote.diffText && (
            <diff
              diff={message.toolNote.diffText}
              view="unified"
              wrapMode="none"
              showLineNumbers
              addedBg="#1e3a26"
              addedContentBg="#1e3a26"
              addedSignColor="#8ce8b0"
              removedBg="#3d2027"
              removedContentBg="#3d2027"
              removedSignColor="#ff9aa8"
              fg="#dfe8ff"
              width="100%"
              marginLeft={2}
            />
          )}
        </box>
      );
    }
    // Other system notices stay compact — a single dim line, no header.
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
  // While the turn is in flight the header grows a sprout — the "thinking"
  // indicator, covering both the silent tool-loop phase and token streaming.
  if (message.role === "assistant") {
    return (
      <box flexDirection="column" width="100%">
        <box flexDirection="row" gap={1}>
          <text fg="#8bb4ff" attributes={TextAttributes.BOLD}>
            syd
          </text>
          {streaming && <ThinkingSprout />}
        </box>
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
    <box
      flexDirection="row"
      width="100%"
      backgroundColor="#12351f"
      paddingX={1}
    >
      <text fg="#7ee2a8" attributes={TextAttributes.BOLD}>
        {"> "}
      </text>
      <text fg="#f3f6ff" wrapMode="word">
        {message.content}
      </text>
    </box>
  );
}
