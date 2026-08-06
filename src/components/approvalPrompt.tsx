import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ApprovalRequest } from "../chat";
import { useTheme } from "./themeContext";
import "./overlayBox";

type ApprovalPromptProps = {
  request: ApprovalRequest;
  onDecide: (approved: boolean) => void;
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

  const argsText =
    request.note == null && request.input != null
      ? formatArgs(request.input)
      : null;

  return (
    <overlay-box
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
    </overlay-box>
  );
}

// Model input may not be JSON-serializable; fall back instead of throwing into the UI.
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
