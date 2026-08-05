import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";
import CommandSuggestions from "./commandSuggestions";
import MentionSuggestions from "./mentionSuggestions";
import { useTheme } from "./themeContext";
import type { Skill } from "../skills";

type chatInputBoxProps = {
  // The session name. Rendered as the inverted chip below the input — the only
  // place it appears, so it reads as the one piece of session identity.
  title: string;
  // Auto-approve mode is on — shown beside the session chip so the current
  // safety posture is always visible, not hidden state.
  autoApprove: boolean;
  // Shell access is enabled — shown alongside auto-approve so the fact that syd
  // can run commands is never hidden state.
  shellEnabled: boolean;
  // Defined skills, for the @-mention autocomplete palette.
  skills: Skill[];
  // False while a popup (e.g. the /resume picker) owns the keyboard.
  focused: boolean;
  onSubmit: (message: string) => void;
};

// Match while the user is still typing the command name: a leading "/" with no
// space yet. Once they type a space they're into args, so the palette closes.
function commandQuery(draft: string): string | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  if (rest.includes(" ")) return null;
  return rest;
}

// The @handle currently being typed at the caret (end of draft): the text after
// the last "@", when that "@" starts the message or follows whitespace and no
// space has been typed since. Null closes the palette. A command draft ("/…")
// never triggers it, so the two palettes are mutually exclusive.
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

// The session chip is sized by its text, and /rename accepts a title of any
// length, so a long one would push the indicator row past the terminal width.
// Clamp what's drawn (never the stored title) to keep the row stable.
const MAX_CHIP_CHARS = 32;

function clampTitle(title: string): string {
  const clean = title.trim() || "New Chat";
  return clean.length > MAX_CHIP_CHARS
    ? `${clean.slice(0, MAX_CHIP_CHARS - 1)}…`
    : clean;
}

export default function ChatInputBox({
  title,
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

  // Only look for an @mention when the command palette isn't already claiming
  // the draft (mutually exclusive by construction, but explicit is clearer).
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

  // Replace the in-progress @handle with the chosen skill and a trailing space,
  // leaving the rest of the draft untouched so mentions work mid-sentence.
  function completeMention(name: string) {
    if (mention === null) return;
    handleInput(`${draft.slice(0, mention.at)}@${name} `);
  }

  // Palette navigation. These fire before the focused <input> handles the key
  // (global keypress listeners run first in OpenTUI), so preventDefault stops
  // the input from also acting on the key — no cursor moves, no stray submit.
  // At most one palette is open; whichever it is drives the same keys.
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
        // A command runs immediately; a mention completes into the draft so the
        // user can keep writing the message around it.
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
      {/* Float the palette as an absolute overlay anchored just above the
          input (4 rows tall: bordered input = 3 + model line = 1). Keeping it
          out of flow means ChatMain doesn't resize when it opens, so the
          centered banner underneath stays put. */}
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
      <box flexDirection="row" justifyContent="flex-end" gap={1}>
        {shellEnabled && <text fg={t.success}>⋅shell</text>}
        {autoApprove && <text fg={t.warning}>⋅auto-approve</text>}
        {/* Inverted chip: the brightest text colour becomes the fill, the app
            background the ink. No width is set, so flexbox sizes the box to its
            content and the block hugs the title exactly; paddingX supplies the
            one-cell gutter. flexShrink={0} keeps it from being squeezed by the
            indicators to its left. Theme tokens rather than a literal white so
            it stays readable on every theme. */}
        <box backgroundColor={t.textStrong} paddingX={1} flexShrink={0}>
          <text fg={t.inverseText}>{chipTitle}</text>
        </box>
      </box>
    </box>
  );
}
