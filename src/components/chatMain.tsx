import { memo, useEffect, useState } from "react";
import { SyntaxStyle, TextAttributes, type BorderCharacters } from "@opentui/core";
import type { Message, SystemTone } from "../commands/type";
import type { ThemeTokens } from "../theme.ts";
import { useTheme } from "./themeContext.tsx";

// The thinking indicator: a seed sprouting into a plant, one frame per tick.
// Grows to full size then restarts from the seed.
const SPROUT_FRAMES = [".", ",", ";", "|", "Y", "ψ"];
const SPROUT_TICK_MS = 260;

function ThinkingSprout() {
  const t = useTheme();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPROUT_FRAMES.length),
      SPROUT_TICK_MS,
    );
    return () => clearInterval(timer);
  }, []);
  return <text fg={t.success}>{SPROUT_FRAMES[frame]}</text>;
}

// --- glow color helpers -----------------------------------------------------
// Linearly interpolate between two "#rrggbb" colors so the loader can pulse a
// smooth ramp of the accent hue (theme tokens are discrete, so we synthesize the
// in-between stops here). Malformed input falls back to white rather than throw
// — this paints every frame, so it must never crash the transcript.
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

// --- system-notice gutter ---------------------------------------------------
// System notices are drawn as a bordered box with only its left side enabled,
// which makes the rule a *layout* feature rather than a character prefixed to
// the text. That's the whole point: a glyph inside the <text> (the old "· ")
// only marks the first line, so a notice long enough to wrap — "copy failed: …",
// the MCP "if your browser didn't open, visit: <url>" pair, a config warning —
// puts its continuation back at column 0 and the marker stops reading as one.
// A border is drawn for the box's full measured height, so every wrapped line
// keeps the rule.
//
// Only `vertical` is ever painted (no other side is enabled), but the
// BorderCharacters contract wants the full set; the left-edge entries all carry
// the rule so a corner never punches a hole in it, and the rest are spaces so
// nothing bleeds in from the unused sides.
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

// Severity lives in the rule's colour alone — the text stays one uniform muted
// grey at every tone. A failure is then findable by scanning one column instead
// of reading, and the transcript never shouts a red sentence at the user for
// something as ordinary as a bad `/rename` argument.
function ruleColor(t: ThemeTokens, tone: SystemTone | undefined): string {
  switch (tone) {
    case "error":
      return t.danger;
    case "warn":
      return t.warning;
    default:
      // Also the landing spot for a tone that survived from a future version's
      // session file — unknown severity reads as neutral rather than crashing.
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

  // The label breathes on a slower triangle wave so it pulses with the sweep
  // without strobing character-by-character.

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
  // Active model id, shown in the empty-session masthead. Owned by App.
  model: string;
};

export default function ChatMain({
  messages,
  streaming,
  model,
}: ChatMainProps) {
  // One shared syntax theme for all rendered markdown. Created lazily on first
  // render (after the renderer's native lib is up) via a useState initializer
  // so it's built exactly once and reused for the app's lifetime — cheaper than
  // one per message and satisfies <markdown>'s required syntaxStyle prop.
  const [syntaxStyle] = useState(() => SyntaxStyle.create());
  const t = useTheme();

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
          // Empty session: the masthead, pinned to the top-left of the area.
          <SydBanner model={model} />
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
      {/* Glowing loader pinned to the base of the transcript (a sibling of the
          flexGrow'd box above), so it sits right on top of the chat input while
          a turn is in flight. */}
      {streaming && <GlowLoader />}
    </box>
  );
}

// Collapse the home prefix to "~" so the masthead shows a path that fits and
// reads the way the user would say it. Falls back to the raw cwd if HOME is
// unset (a bare cron/CI shell), never to an empty string.
function shortCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME;
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

// New-session masthead: the syd wordmark with a three-line colophon beside it,
// shown while the chat is empty (a fresh session, or opening syd in a
// directory). Pinned to the top-left of the chat area. The inner row lays the
// wordmark and the colophon side by side; alignItems="center" centres the three
// short lines against the wordmark's six, so neither block looks dropped.
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
        {/* Every OpenTUI ascii font is uppercase-only — lowercase renders blank.
            "pallet" draws double-line glyphs in colour 1 over a "─" fill that
            covers the whole bounding box in colour 2, so the two-stop gradient
            reads as letters-on-a-ground rather than a shaded letter edge. */}
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

// Memoized so a streaming flush only re-renders the one bubble whose props
// actually changed. Every 33ms flush hands ChatMain a new `messages` array, but
// App's functional setMessages (slice + spread-the-last) preserves each
// unchanged message's *object reference*, so React.memo's default shallow
// compare (message ref, stable syntaxStyle, streaming=false for all but the
// last) skips every finished bubble. Only the live tail — new message ref plus
// streaming=true — re-renders. Without this, the whole transcript re-renders and
// the <scrollbox> re-measures on every token, which is what made the in-flight
// text jump and garble. This is the OpenTUI equivalent of Ink's <Static>.
const MessageBlock = memo(function MessageBlock({
  message,
  syntaxStyle,
  streaming,
}: MessageBlockProps) {
  const t = useTheme();
  if (message.role === "system") {
    // Tool activity: "↳ edited src/x.ts" plus a red/green highlighted diff
    // when the tool changed a file.
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
    // Other system notices: a quiet blockquote. No header and no marker in the
    // text — the rule in the gutter is what says "this is the app talking, not
    // the conversation", and its colour is what says how badly it went.
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
          {streaming && <ThinkingSprout />}
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

  // User turns are shown verbatim — no markdown parsing on what they typed.
  return (
    <box
      flexDirection="row"
      width="100%"
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
