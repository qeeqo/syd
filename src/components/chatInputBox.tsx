import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { commandList } from "../commands/registry";
import CommandSuggestions from "./commandSuggestions";

type chatInputBoxProps = {
  title: string;
  model: string;
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

export default function ChatInputBox({
  title,
  model,
  focused,
  onSubmit,
}: chatInputBoxProps) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query = commandQuery(draft);
  const matches =
    query === null
      ? []
      : commandList.filter((c) => c.name.startsWith(query.toLowerCase()));
  const paletteOpen = !dismissed && matches.length > 0;

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

  // Palette navigation. These fire before the focused <input> handles the key
  // (global keypress listeners run first in OpenTUI), so preventDefault stops
  // the input from also acting on the key — no cursor moves, no stray submit.
  useKeyboard((key) => {
    if (!paletteOpen) return;

    switch (key.name) {
      case "up":
        key.preventDefault();
        setSelected((i) => (i - 1 + matches.length) % matches.length);
        break;
      case "down":
        key.preventDefault();
        setSelected((i) => (i + 1) % matches.length);
        break;
      case "tab":
        // Complete the highlighted command into the input for editing/args.
        key.preventDefault();
        handleInput(`/${matches[selected].name} `);
        break;
      case "return":
        // Run the highlighted command immediately.
        key.preventDefault();
        submit(`/${matches[selected].name}`);
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
      {paletteOpen && (
        <box position="absolute" left={0} bottom={4}>
          <CommandSuggestions items={matches} selectedIndex={selected} />
        </box>
      )}
      <box
        border={["top", "bottom"]}
        borderColor="#4f8cff"
        title={` ${title} `}
        titleAlignment="right"
        titleColor="#8bb4ff"
        flexDirection="column"
      >
        <box flexDirection="row">
          <input
            value={draft}
            placeholder="Ask syd anything..."
            focused={focused}
            paddingLeft={1}
            flexGrow={1}
            onInput={handleInput}
            onSubmit={handleSubmit}
          />
        </box>
      </box>
      <box alignItems="flex-end">
        <text fg="#8bb4ff">⋅{model}</text>
      </box>
    </box>
  );
}
