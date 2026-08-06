import { memo, useEffect, useMemo, useState } from "react";
import { SyntaxStyle, TextAttributes, type BorderCharacters } from "@opentui/core";
import type { Message, SystemTone } from "../commands/type";
import type { ThemeTokens } from "../theme.ts";
import { useTheme } from "./themeContext.tsx";

// Theme tokens are discrete, so the loader's in-between stops are synthesized
// here. Malformed input falls back to white rather than throwing — this paints
// every frame and must never crash the transcript.
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixColor(a: string, b: string, ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

function createSyntaxStyle(t: ThemeTokens): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: t.text },
    conceal: { fg: t.textFaint },

    // Tree-sitter capture groups used inside fenced code blocks. OpenTUI falls
    // back from names such as function.call to their registered base group.
    keyword: { fg: t.accent, bold: true },
    string: { fg: t.success },
    comment: { fg: t.textDim, italic: true },
    number: { fg: t.warning },
    boolean: { fg: t.warningBright },
    constant: { fg: t.warning },
    function: { fg: t.info },
    constructor: { fg: t.info, bold: true },
    type: { fg: t.warningBright },
    variable: { fg: t.text },
    property: { fg: t.textSecondary },
    operator: { fg: t.accent },
    punctuation: { fg: t.textSecondary },
    attribute: { fg: t.info },
    tag: { fg: t.danger },
    label: { fg: t.warning },
    module: { fg: t.info },

    // Markdown prose surrounding code blocks.
    "markup.heading": { fg: t.accent, bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { fg: t.info, italic: true },
    "markup.strikethrough": { fg: t.textMuted, dim: true },
    "markup.raw": { fg: t.successBright },
    "markup.link": { fg: t.textDim },
    "markup.link.label": { fg: t.accent, underline: true },
    "markup.link.url": { fg: t.textDim, underline: true },
    "markup.quote": { fg: t.textSecondary, italic: true },
    "markup.list": { fg: t.accent },
  });
}

// A left border, not a glyph prefixed to the text: the border is drawn for the
// box's full height, so a wrapped notice keeps the rule on every line.
// Only `vertical` is painted, but BorderCharacters wants the whole set — the
// left-edge entries all carry the rule so a corner can't punch a hole in it.
const RULE = "▏";
const RULE_CHARS: BorderCharacters = {
  topLeft: RULE,
  topRight: " ",
  bottomLeft: RULE,
  bottomRight: " ",
  horizontal: " ",
  vertical: RULE,
  topT: RULE,
  bottomT: RULE,
  leftT: RULE,
  rightT: " ",
  cross: " ",
};

// Severity is carried by the rule's colour alone; the text stays one muted grey
// at every tone, so the transcript never shouts over a bad /rename argument.
function ruleColor(t: ThemeTokens, tone: SystemTone | undefined): string {
  switch (tone) {
    case "error":
      return t.danger;
    case "warn":
      return t.warning;
    default: // also catches an unknown tone from a newer version's session file
      return t.textDim;
  }
}

const GLOW_DOTS = 5;
const GLOW_TICK_MS = 110;

function GlowLoader() {
  const t = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), GLOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Bounce the highlight head 0 → GLOW_DOTS-1 → 0 across the row.
  const period = (GLOW_DOTS - 1) * 2;
  const phase = tick % period;
  const head = phase < GLOW_DOTS ? phase : period - phase;

  return (
    <box flexDirection="row" gap={1} paddingX={2} marginTop={1}>
      <box flexDirection="row">
        {Array.from({ length: GLOW_DOTS }, (_, i) => {
          const glow = Math.max(0, 1 - Math.abs(i - head) / 2);
          return (
            <text key={i} fg={mixColor(t.textFaint, t.accent, glow)}>
              _
            </text>
          );
        })}
      </box>
    </box>
  );
}

type ChatMainProps = {
  messages: Message[];
  streaming: boolean;
  model: string;
};

export default function ChatMain({
  messages,
  streaming,
  model,
}: ChatMainProps) {
  const t = useTheme();
  // SyntaxStyle owns a native handle. Recreate it for a live theme preview and
  // release the old handle after React commits the replacement.
  const syntaxStyle = useMemo(() => createSyntaxStyle(t), [t]);
  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  return (
    <box
      flexDirection="column"
      padding={1}
      width="100%"
      flexGrow={1}
      backgroundColor={t.transcriptBg}
    >
      <box
        title=" sydcli "
        titleColor={t.accent}
        flexDirection="column"
        flexGrow={1}
      >
        {messages.length === 0 ? (
          <SydBanner model={model} />
        ) : (
          /* Clips to the viewport instead of overflowing onto the input box.
             stickyScroll pins the latest output while streaming, and releases
             once the user scrolls up to read earlier messages. */
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
      {streaming && <GlowLoader />}
    </box>
  );
}

// Falls back to the raw cwd when HOME is unset (a bare cron/CI shell).
function shortCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME;
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

// alignItems="center" centres the colophon's three lines against the wordmark's
// six, so neither block looks dropped.
function SydBanner({ model }: { model: string }) {
  const t = useTheme();
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      justifyContent="flex-start"
      alignItems="flex-start"
      paddingLeft={2}
      paddingTop={1}
    >
      <box flexDirection="row" alignItems="center" gap={3}>
        {/* Uppercase only — every OpenTUI ascii font renders lowercase blank.
            "pallet" draws glyphs in colour 1 over a fill in colour 2. */}
        <ascii-font text="SYD" font="pallet" color={[t.accent, t.accentDeep]} />
        <box flexDirection="column">
          <text fg={t.textDim}>{shortCwd()}</text>
          <text fg={t.textDim}>{model}</text>
          <text fg={t.textFaint}>/help</text>
        </box>
      </box>
    </box>
  );
}

type MessageBlockProps = {
  message: Message;
  syntaxStyle: SyntaxStyle;
  // True only while this specific turn is actively receiving streamed tokens.
  streaming: boolean;
};

// Load-bearing: without memo the whole transcript re-renders and the <scrollbox>
// re-measures on every flush, which makes in-flight text jump and garble. It
// works because App's setMessages preserves the object reference of every
// unchanged message, so the shallow compare skips all but the live tail.
const MessageBlock = memo(function MessageBlock({
  message,
  syntaxStyle,
  streaming,
}: MessageBlockProps) {
  const t = useTheme();
  if (message.role === "system") {
    if (message.toolNote) {
      return (
        <box flexDirection="column" width="100%">
          <text fg={t.textSecondary} wrapMode="word">
            ↳ {message.toolNote.label}
          </text>
          {message.toolNote.diffText && (
            <diff
              diff={message.toolNote.diffText}
              view="unified"
              wrapMode="none"
              showLineNumbers
              addedBg={t.diffAddBg}
              addedContentBg={t.diffAddBg}
              addedSignColor={t.successBright}
              removedBg={t.diffRemoveBg}
              removedContentBg={t.diffRemoveBg}
              removedSignColor={t.danger}
              fg={t.text}
              width="100%"
              marginLeft={2}
            />
          )}
        </box>
      );
    }
    return (
      <box
        flexDirection="column"
        width="100%"
        border={["left"]}
        borderColor={ruleColor(t, message.tone)}
        customBorderChars={RULE_CHARS}
        paddingLeft={1}
      >
        <text fg={t.textMuted} wrapMode="word">
          {message.content}
        </text>
      </box>
    );
  }

  if (message.role === "assistant") {
    return (
      <box flexDirection="column" width="100%">
        <box flexDirection="row" gap={1}>
          <text fg={t.accent} attributes={TextAttributes.BOLD}>
            syd
          </text>
        </box>
        <markdown
          content={message.content}
          syntaxStyle={syntaxStyle}
          fg={t.text}
          streaming={streaming}
          width="100%"
        />
      </box>
    );
  }

  // Verbatim — no markdown parsing on what the user typed.
  //
  // alignSelf lets the tinted band size to its content instead of spanning the
  // column; maxWidth then keeps a long message wrapping at the container edge
  // rather than growing to the full length of an unwrapped line.
  return (
    <box
      flexDirection="row"
      alignSelf="flex-start"
      maxWidth="100%"
      backgroundColor={t.userBg}
      paddingX={1}
    >
      <text fg={t.success} attributes={TextAttributes.BOLD}>
        {"> "}
      </text>
      <text fg={t.textStrong} wrapMode="word">
        {message.content}
      </text>
    </box>
  );
});
