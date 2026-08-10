import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";
import CommandSuggestions from "./commandSuggestions";
import MentionSuggestions from "./mentionSuggestions";
import { useTheme } from "./themeContext";
import type { Skill } from "../skills";
import type { ReasoningLevel } from "../reasoning";

type chatInputBoxProps = {
  title: string;
  model: string;
  reasoning: ReasoningLevel;
  // Keep auto-approval visible rather than hidden state.
  autoApprove: boolean;
  // Keep shell access visible rather than hidden state.
  shellEnabled: boolean;
  contextChars: number;
  skills: Skill[];
  focused: boolean;
  // false means the message was refused; the draft stays for the user to retry.
  onSubmit: (message: string) => boolean;
};

function commandQuery(draft: string): string | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  if (rest.includes(" ")) return null;
  return rest;
}

function mentionQuery(draft: string): { at: number; query: string } | null {
  if (draft.startsWith("/")) return null;
  const at = draft.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(draft[at - 1])) return null; // mid-word @, e.g. email
  const rest = draft.slice(at + 1);
  if (/\s/.test(rest)) return null;
  if (!/^[a-z0-9-]*$/i.test(rest)) return null;
  return { at, query: rest };
}

// Clamp only the rendered title so long names cannot overflow the indicator row.
const MAX_CHIP_CHARS = 32;

// Long provider model IDs need the same display-only cap.
const MAX_MODEL_CHARS = 30;

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clampTitle(title: string): string {
  return clamp(title.trim() || "New Chat", MAX_CHIP_CHARS);
}

const CHARS_PER_TOKEN = 4;

const CONTEXT_BUSY_CHARS = 200_000;

function formatContext(chars: number): string | null {
  if (chars === 0) return null;
  const tokens = Math.round(chars / CHARS_PER_TOKEN);
  if (tokens < 1_000) return `~${tokens} tok`;
  const thousands = tokens / 1_000;
  return `~${thousands.toFixed(thousands < 10 ? 1 : 0)}k tok`;
}

export default function ChatInputBox({
  title,
  model,
  reasoning,
  autoApprove,
  shellEnabled,
  skills,
  focused,
  contextChars,
  onSubmit,
}: chatInputBoxProps) {
  const t = useTheme();
  const chipTitle = clampTitle(title);
  const contextLabel = formatContext(contextChars);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query = commandQuery(draft);
  const matches =
    query === null
      ? []
      : commandList.filter((c) => c.name.startsWith(query.toLowerCase()));
  const commandPaletteOpen = !dismissed && matches.length > 0;

  const mention = commandPaletteOpen ? null : mentionQuery(draft);
  const mentionMatches =
    mention === null
      ? []
      : skills.filter((s) => s.name.startsWith(mention.query.toLowerCase()));
  const mentionPaletteOpen = !dismissed && mentionMatches.length > 0;

  function handleInput(value: string) {
    setDraft(value);
    setSelected(0);
    setDismissed(false);
  }

  function submit(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    if (!onSubmit(trimmed)) return;
    setDraft("");
    setSelected(0);
    setDismissed(false);
  }

  function handleSubmit() {
    submit(draft);
  }

  // Leaves the rest of the draft untouched, so mentions work mid-sentence.
  function completeMention(name: string) {
    if (mention === null) return;
    handleInput(`${draft.slice(0, mention.at)}@${name} `);
  }

  // OpenTUI runs global listeners before the focused input; preventDefault avoids duplicate handling.
  useKeyboard((key) => {
    const active = commandPaletteOpen
      ? "command"
      : mentionPaletteOpen
        ? "mention"
        : null;
    if (active === null) return;
    const count = active === "command" ? matches.length : mentionMatches.length;

    switch (key.name) {
      case "up":
        key.preventDefault();
        setSelected((i) => (i - 1 + count) % count);
        break;
      case "down":
        key.preventDefault();
        setSelected((i) => (i + 1) % count);
        break;
      case "tab":
        key.preventDefault();
        if (active === "command") handleInput(`/${matches[selected].name} `);
        else completeMention(mentionMatches[selected].name);
        break;
      case "return":
        key.preventDefault();
        if (active === "command") submit(`/${matches[selected].name}`);
        else completeMention(mentionMatches[selected].name);
        break;
      case "escape":
        key.preventDefault();
        setDismissed(true);
        break;
    }
  });

  return (
    <box
      position="relative"
      flexDirection="column"
      flexShrink={0}
      marginX={1}
      marginBottom={0}
    >
      {/* Keep palettes out of flow; bottom=4 clears the 3-row input and 1-row indicators. */}
      {commandPaletteOpen && (
        <box position="absolute" left={0} bottom={4}>
          <CommandSuggestions items={matches} selectedIndex={selected} />
        </box>
      )}
      {mentionPaletteOpen && (
        <box position="absolute" left={0} bottom={4}>
          <MentionSuggestions items={mentionMatches} selectedIndex={selected} />
        </box>
      )}
      <box
        border
        borderColor={t.inputBorder}
        flexDirection="column"
      >
        <box flexDirection="row">
          <input
            value={draft}
            focused={focused}
            paddingLeft={1}
            flexGrow={1}
            textColor={t.textStrong}
            focusedTextColor={t.textStrong}
            cursorColor={t.accent}
            selectionBg={t.selectionBg}
            selectionFg={t.textSelected}
            onInput={handleInput}
            onSubmit={handleSubmit}
          />
        </box>
      </box>
      {/* Let the model group shrink before the session and safety indicators. */}
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <box flexDirection="row" gap={1} flexShrink={1}>
          <text fg={t.textDim}>{clamp(model, MAX_MODEL_CHARS)}</text>
          {reasoning !== "default" && (
            <text fg={t.info}>thinking {reasoning}</text>
          )}
          {contextLabel && (
            <text
              fg={contextChars >= CONTEXT_BUSY_CHARS ? t.warning : t.textDim}
              flexShrink={0}
            >
              {contextLabel}
            </text>
          )}
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          {shellEnabled && <text fg={t.success}>shell</text>}
          {autoApprove && <text fg={t.warning}>auto-approve</text>}
          <box backgroundColor={t.textStrong} paddingX={1} flexShrink={0}>
            <text fg={t.inverseText}>{chipTitle}</text>
          </box>
        </box>
      </box>
    </box>
  );
}
