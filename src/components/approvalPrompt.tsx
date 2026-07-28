import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ApprovalRequest } from "../chat";
import { useTheme } from "./themeContext";

type ApprovalPromptProps = {
  request: ApprovalRequest;
  // Called exactly once with the user's decision; App resolves the paused
  // stream with it.
  onDecide: (approved: boolean) => void;
  // Approve this change AND switch to auto-approve for the rest of the session
  // — the escape hatch for a multi-file change you've already committed to.
  onApproveAll: () => void;
};

export default function ApprovalPrompt({
  request,
  onDecide,
  onApproveAll,
}: ApprovalPromptProps) {
  const t = useTheme();
  useKeyboard((key) => {
    switch (key.name) {
      case "return":
      case "y":
        key.preventDefault();
        onDecide(true);
        break;
      case "a":
        key.preventDefault();
        onApproveAll();
        break;
      case "escape":
      case "n":
        key.preventDefault();
        onDecide(false);
        break;
    }
  });

  const label = request.note?.label ?? `run ${request.tool}`;

  // Fall back to pretty-printing the call's arguments only when we have no
  // structured preview at all — i.e. an MCP tool (null note). File tools carry a
  // diff, and the shell tool puts its command in the label, so in both cases the
  // note already shows the concrete thing being authorized and the raw JSON args
  // would just be noise. Empty/absent args → nothing to show.
  const argsText =
    request.note == null && request.input != null
      ? formatArgs(request.input)
      : null;

  return (
    <box
      border
      borderColor={t.warnBorder}
      backgroundColor={t.panelBg}
      title=" approve change? "
      titleColor={t.warningBright}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      <text fg={t.text} wrapMode="word">
        syd wants to {label}
      </text>
      {request.note?.diffText && (
        /* Tall diffs scroll inside the popup instead of growing past the
           screen; small ones take only the height they need. */
        <scrollbox
          scrollY
          maxHeight={14}
          marginTop={1}
          verticalScrollbarOptions={{ visible: false }}
          contentOptions={{ flexDirection: "column", width: "100%" }}
        >
          <diff
            diff={request.note.diffText}
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
          />
        </scrollbox>
      )}
      {argsText && (
        <scrollbox
          scrollY
          maxHeight={14}
          marginTop={1}
          verticalScrollbarOptions={{ visible: false }}
          contentOptions={{ flexDirection: "column", width: "100%" }}
        >
          <text fg={t.textSecondary} wrapMode="word">
            {argsText}
          </text>
        </scrollbox>
      )}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={t.successBright} attributes={TextAttributes.BOLD}>
          [y / enter] approve
        </text>
        <text fg={t.danger} attributes={TextAttributes.BOLD}>
          [n / esc] deny
        </text>
        <text fg={t.warning} attributes={TextAttributes.BOLD}>
          [a] approve all
        </text>
      </box>
    </box>
  );
}

// Pretty-print a tool call's arguments for the popup. Defensive: input is
// whatever the model produced, so a value that can't be stringified (a cycle,
// a bigint) falls back to a plain String() rather than throwing into the UI.
// An empty object has nothing worth showing.
function formatArgs(input: unknown): string | null {
  if (input && typeof input === "object" && Object.keys(input).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
