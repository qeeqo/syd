import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ApprovalRequest } from "../chat";

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

  // File tools carry a diff to review. MCP (and other non-file) tools don't, so
  // fall back to pretty-printing the call's arguments — the concrete thing the
  // user is being asked to authorize. Empty/absent args → nothing to show.
  const argsText =
    !request.note?.diffText && request.input != null
      ? formatArgs(request.input)
      : null;

  return (
    <box
      border
      borderColor="#5a4a2a"
      backgroundColor="#141824"
      title=" approve change? "
      titleColor="#e8c477"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="80%"
      maxWidth={100}
    >
      <text fg="#dfe8ff" wrapMode="word">
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
            addedBg="#1e3a26"
            addedContentBg="#1e3a26"
            addedSignColor="#8ce8b0"
            removedBg="#3d2027"
            removedContentBg="#3d2027"
            removedSignColor="#ff9aa8"
            fg="#dfe8ff"
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
          <text fg="#9aa4b2" wrapMode="word">
            {argsText}
          </text>
        </scrollbox>
      )}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg="#8ce8b0" attributes={TextAttributes.BOLD}>
          [y / enter] approve
        </text>
        <text fg="#ff9aa8" attributes={TextAttributes.BOLD}>
          [n / esc] deny
        </text>
        <text fg="#c9a24f" attributes={TextAttributes.BOLD}>
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
