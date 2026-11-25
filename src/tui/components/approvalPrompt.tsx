import { useEffect, useRef, useState, type RefObject } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { ApprovalRequest } from "../../core/chat";
import { visualizeControls } from "../sanitize";
import { useTheme } from "./themeContext";

type ApprovalPromptProps = {
  request: ApprovalRequest;
  onDecide: (approved: boolean) => void;
  onApproveAll: () => void;
  lastKeyAt: RefObject<number>;
};

// A key typed just before the dock appears must not decide it — the same race
// Codex fixed in openai/codex#19513.
const ARM_AFTER_MOUNT_MS = 400;
const ARM_AFTER_TYPING_MS = 1000;

// Keep the model's latest output visible above the dock unless fullscreen.
const DOCK_SHARE = 0.6;
const MIN_TRANSCRIPT_ROWS = 6;
const INDICATOR_ROWS = 1;
const BORDER_ROWS = 2;
const MIN_DOCK_ROWS = 8;

export function approvalTitle(request: ApprovalRequest): string {
  if (request.tool === "runCommand") return " approve command? ";
  if (request.note == null) return " approve tool call? ";
  return " approve change? ";
}

function dockRows(terminalRows: number, fullscreen: boolean): number {
  const available = terminalRows - INDICATOR_ROWS;
  if (fullscreen) return available;
  const capped = Math.min(
    Math.floor(terminalRows * DOCK_SHARE),
    available - MIN_TRANSCRIPT_ROWS,
  );
  return Math.min(available, Math.max(MIN_DOCK_ROWS, capped));
}

// runCommand trims before spawning, so the preview shows exactly what will run.
function commandOf(request: ApprovalRequest): string | null {
  const input = request.input as { command?: unknown } | null;
  return request.tool === "runCommand" && typeof input?.command === "string"
    ? input.command.trim()
    : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function hiddenLabel(above: number, below: number): string | null {
  if (above > 0 && below > 0) {
    return `▲ ${above} above · ▼ ${below} below · ↑↓ scroll`;
  }
  if (below > 0) return `▼ ${plural(below, "more line")} below · ↑↓ scroll`;
  if (above > 0) return `▲ ${plural(above, "line")} above · ↑↓ scroll`;
  return null;
}

export default function ApprovalPrompt({
  request,
  onDecide,
  onApproveAll,
  lastKeyAt,
}: ApprovalPromptProps) {
  const t = useTheme();
  const { height } = useTerminalDimensions();
  const boxRef = useRef<ScrollBoxRenderable | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [hidden, setHidden] = useState({ above: 0, below: 0 });

  const command = commandOf(request);
  const isCommand = request.tool === "runCommand";

  useEffect(() => {
    const wait = Math.max(
      ARM_AFTER_MOUNT_MS,
      lastKeyAt.current + ARM_AFTER_TYPING_MS - Date.now(),
    );
    const timer = setTimeout(() => setArmed(true), wait);
    return () => clearTimeout(timer);
  }, [lastKeyAt]);

  function measure() {
    const box = boxRef.current;
    if (!box) return;
    const above = Math.max(0, Math.round(box.scrollTop));
    const below = Math.max(
      0,
      Math.round(box.scrollHeight - box.scrollTop - box.viewport.height),
    );
    setHidden((prev) =>
      prev.above === above && prev.below === below ? prev : { above, below },
    );
  }

  // Layout and mouse callbacks fire before the scrollbox has applied the change
  // (its own viewport/scrollbar handlers can't be hooked — passing onSizeChange
  // or onChange through its options replaces them), so read once it settles.
  function measureSoon() {
    queueMicrotask(measure);
  }

  useKeyboard((key) => {
    const box = boxRef.current;
    const page = Math.max(1, (box?.viewport.height ?? 2) - 1);
    switch (key.name) {
      case "up":
        key.preventDefault();
        box?.scrollBy(-1);
        measureSoon();
        break;
      case "down":
        key.preventDefault();
        box?.scrollBy(1);
        measureSoon();
        break;
      case "pageup":
        key.preventDefault();
        box?.scrollBy(-page);
        measureSoon();
        break;
      case "pagedown":
        key.preventDefault();
        box?.scrollBy(page);
        measureSoon();
        break;
      case "f":
        key.preventDefault();
        setFullscreen((v) => !v);
        break;
      case "escape":
        key.preventDefault();
        onDecide(false);
        break;
      case "y":
        if (!armed) return;
        key.preventDefault();
        onDecide(true);
        break;
      case "n":
        if (!armed) return;
        key.preventDefault();
        onDecide(false);
        break;
      case "a":
        // Shell commands are never auto-approved, so "all" would be a lie here.
        if (!armed || isCommand) return;
        key.preventDefault();
        onApproveAll();
        break;
    }
  });

  const header =
    command !== null
      ? `syd wants to run a shell command · ${plural(command.split("\n").length, "line")} · ${plural(command.length, "char")}`
      : `syd wants to ${visualizeControls(request.note?.label ?? `run ${request.tool}`)}`;

  const argsText =
    command === null && request.note == null && request.input != null
      ? formatArgs(request.input)
      : null;
  const diffText = command === null ? request.note?.diffText : undefined;
  const hasBody = command !== null || Boolean(diffText) || argsText !== null;
  const more = hiddenLabel(hidden.above, hidden.below);

  return (
    <box
      flexDirection="column"
      paddingX={1}
      maxHeight={dockRows(height, fullscreen) - BORDER_ROWS}
    >
      <text fg={t.text} wrapMode="word" flexShrink={0}>
        {header}
      </text>
      {hasBody && (
        <scrollbox
          ref={boxRef}
          scrollY
          flexShrink={1}
          onSizeChange={measureSoon}
          onMouseScroll={measureSoon}
          // A visible scrollbar overdraws the last content column, dropping one
          // character per wrapped row; the more-lines line signals overflow instead.
          verticalScrollbarOptions={{ visible: false }}
          contentOptions={{ flexDirection: "column", width: "100%" }}
        >
          <box
            flexDirection="column"
            width="100%"
            onSizeChange={measureSoon}
          >
            {command !== null && (
              <box border={["left"]} borderColor={t.textDim} paddingLeft={1}>
                <text fg={t.textStrong} wrapMode="char">
                  {visualizeControls(command)}
                </text>
              </box>
            )}
            {diffText && (
              <diff
                diff={diffText}
                view="unified"
                wrapMode="word"
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
            )}
            {argsText !== null && (
              <text fg={t.textSecondary} wrapMode="char">
                {argsText}
              </text>
            )}
          </box>
        </scrollbox>
      )}
      {more && (
        <text fg={t.warning} flexShrink={0}>
          {more}
        </text>
      )}
      <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
        <text
          fg={armed ? t.successBright : t.textDim}
          attributes={TextAttributes.BOLD}
        >
          [y] approve
        </text>
        <text
          fg={armed ? t.danger : t.textDim}
          attributes={TextAttributes.BOLD}
        >
          [n / esc] deny
        </text>
        {!isCommand && (
          <text
            fg={armed ? t.warning : t.textDim}
            attributes={TextAttributes.BOLD}
          >
            [a] approve all
          </text>
        )}
        <text fg={t.textDim}>[f] {fullscreen ? "shrink" : "fullscreen"}</text>
      </box>
    </box>
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
