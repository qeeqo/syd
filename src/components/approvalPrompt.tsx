import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ApprovalRequest } from "../chat";

type ApprovalPromptProps = {
  request: ApprovalRequest;
  // Called exactly once with the user's decision; App resolves the paused
  // stream with it.
  onDecide: (approved: boolean) => void;
};

export default function ApprovalPrompt({
  request,
  onDecide,
}: ApprovalPromptProps) {
  useKeyboard((key) => {
    switch (key.name) {
      case "return":
      case "y":
        key.preventDefault();
        onDecide(true);
        break;
      case "escape":
      case "n":
        key.preventDefault();
        onDecide(false);
        break;
    }
  });

  const label = request.note?.label ?? `run ${request.tool}`;

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
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg="#8ce8b0" attributes={TextAttributes.BOLD}>
          [y / enter] approve
        </text>
        <text fg="#ff9aa8" attributes={TextAttributes.BOLD}>
          [n / esc] deny
        </text>
      </box>
    </box>
  );
}
