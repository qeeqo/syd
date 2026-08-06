import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";
import CommandSuggestions from "./commandSuggestions";
import MentionSuggestions from "./mentionSuggestions";
import { useTheme } from "./themeContext";
import type { Skill } from "../skills";
import type { ReasoningLevel } from "../reasoning";

type chatInputBoxProps = {
  // Rendered as the inverted chip below the input — the only place it appears.
  title: string;
  // chatMain's banner also shows it, but only while the transcript is empty.
  model: string;
  // Rendered only when it isn't "default", so the row stays quiet unless the
  // user deliberately changed it.
  reasoning: ReasoningLevel;
  // Shown beside the session chip so the safety posture is never hidden state.
  autoApprove: boolean;
  // Same — that syd can run commands must never be hidden state.
  shellEnabled: boolean;
  skills: Skill[];
  // False while a popup owns the keyboard.
  focused: boolean;
  onSubmit: (message: string) => void;
};

// Matches only while the command name is still being typed — once a space is
// typed the user is into args, so the palette closes.
function commandQuery(draft: string): string | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  if (rest.includes(" ")) return null;
  return rest;
}

// Null closes the palette. A command draft ("/…") never triggers it, so the two
// palettes are mutually exclusive.
function mentionQuery(draft: string): { at: number; query: string } | null {
  if (draft.startsWith("/")) return null;
  const at = draft.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(draft[at - 1])) return null; // mid-word @, e.g. email
  const rest = draft.slice(at + 1);
  if (/\s/.test(rest)) return null; // finished this mention
  if (!/^[a-z0-9-]*$/i.test(rest)) return null; // not a handle charset
  return { at, query: rest };
}

// /rename accepts any length, so clamp what's *drawn* (never the stored title)
// to keep the indicator row from running past the terminal width.
const MAX_CHIP_CHARS = 32;

// Same for the model id, which some providers make genuinely long.
const MAX_MODEL_CHARS = 30;

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clampTitle(title: string): string {
  return clamp(title.trim() || "New Chat", MAX_CHIP_CHARS);
}

export default function ChatInputBox({
  title,
  model,
  reasoning,
  autoApprove,
  shellEnabled,
  skills,
  focused,
  onSubmit,
}: chatInputBoxProps) {
  const t = useTheme();
  const chipTitle = clampTitle(title);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query = commandQuery(draft);
  const matches =
    query === null
      ? []
      : commandList.filter((c) => c.name.startsWith(query.toLowerCase()));
  const commandPaletteOpen = !dismissed && matches.length > 0;

  // Mutually exclusive by construction, but explicit is clearer.
  const mention = commandPaletteOpen ? null : mentionQuery(draft);
  const mentionMatches =
    mention === null
      ? []
      : skills.filter((s) => s.name.startsWith(mention.query.toLowerCase()));
  const mentionPaletteOpen = !dismissed && mentionMatches.length > 0;

  function handleInput(value: string) {
    setDraft(value);
    setSelected(0); // re-filtering resets the highlight to the top match
    setDismissed(false); // typing re-opens a palette that was escaped away
  }

  function submit(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
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

  // These fire before the focused <input> sees the key (global listeners run
  // first in OpenTUI), so preventDefault stops it from also acting — no stray
  // cursor moves or submits.
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
        // A command runs immediately; a mention completes into the draft so
        // the user can keep writing around it.
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
      marginBottom={0}
    >
      {/* Out of flow, so opening the palette doesn't resize ChatMain and shift
          the banner underneath. bottom=4 clears the bordered input (3) plus the
          indicator row (1). */}
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
        border={["top", "bottom"]}
        borderColor={t.inputBorder}
        flexDirection="column"
      >
        <box flexDirection="row">
          <input
            value={draft}
            focused={focused}
            paddingLeft={1}
            flexGrow={1}
            onInput={handleInput}
            onSubmit={handleSubmit}
          />
        </box>
      </box>
      {/* space-between splits the two groups so neither's width depends on the
          other. The left group shrinks first — a long model id gives ground
          before the session chip does. */}
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <box flexDirection="row" gap={1} flexShrink={1}>
          <text fg={t.textDim}>{clamp(model, MAX_MODEL_CHARS)}</text>
          {reasoning !== "default" && (
            <text fg={t.info}>thinking {reasoning}</text>
          )}
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          {shellEnabled && <text fg={t.success}>shell</text>}
          {autoApprove && <text fg={t.warning}>auto-approve</text>}
          {/* Content-sized, so the block hugs the title exactly and paddingX
              supplies the gutter. Theme tokens rather than a literal white, so
              it stays readable on every theme. */}
          <box backgroundColor={t.textStrong} paddingX={1} flexShrink={0}>
            <text fg={t.inverseText}>{chipTitle}</text>
          </box>
        </box>
      </box>
    </box>
  );
}
