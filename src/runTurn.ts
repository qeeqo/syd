import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  closeTurn,
  toModelMessages,
  type Entry,
  type SystemTone,
} from "./commands/type";
import { findMentionedSkills, type Skill } from "./skills";
import type { ProviderId } from "./providers";
import type { ToolSet } from "ai";
import type { ReasoningLevel } from "./reasoning";
import { streamChat, type ApprovalRequest } from "./chat";
import type { ModelMessage } from "ai";
import {
  describeToolEvent,
  type AskUserRequest,
  type SkillActions,
} from "./tools";

export async function runTurn(
  message: string,
  deps: {
    entries: Entry[];
    setEntries: Dispatch<SetStateAction<Entry[]>>;
    abortRef: RefObject<AbortController | null>;
    skills: Skill[];
    provider: ProviderId;
    model: string;
    shellEnabled: boolean;
    mcpTools: ToolSet;
    mcpGated: string[];
    reasoning: ReasoningLevel;
    setIsStreaming: Dispatch<SetStateAction<boolean>>;
    setApproval: Dispatch<
      SetStateAction<{
        request: ApprovalRequest;
        resolve: (approved: boolean) => void;
      } | null>
    >;
    pendingDelta: RefObject<string>;
    flushHandle: RefObject<ReturnType<typeof setTimeout> | null>;
    autoApproveRef: RefObject<boolean>;
    askUserResolve: RefObject<((answer: string) => void) | null>;
    onAskUser: (Request: AskUserRequest) => Promise<string>;
    skillActions: SkillActions;
    flushDelta: () => void;
    DELTA_FLUSH_MS: number;
    insertDuringStream: (entry: Entry) => void;
    settleUserAnswer: (answer: string) => void;
    addSystemMessage: (text: string, tone?: SystemTone) => void;
  },
) {
  const invokedSkills = findMentionedSkills(message, deps.skills);

  const userEntry: Entry = {
    kind: "user",
    text: message,
    msgs: [{ role: "user", content: message }],
  };

  const history = [...toModelMessages(deps.entries), ...userEntry.msgs];

  deps.setEntries((prev) => [
    ...prev,
    userEntry,
    { kind: "assistant", text: "", msgs: [] },
  ]);

  const controller = new AbortController();
  deps.abortRef.current = controller;
  deps.setIsStreaming(true);
  let produced: ModelMessage[] = [];
  try {
    produced = await streamChat({
      provider: deps.provider,
      model: deps.model,
      messages: history,
      mcpTools: deps.mcpTools,
      mcpGated: deps.mcpGated,
      shellEnabled: deps.shellEnabled,
      reasoning: deps.reasoning,
      skills: invokedSkills,
      onAskUser: deps.onAskUser,
      skillActions: deps.skillActions,
      abortSignal: controller.signal,
      onDelta: (delta) => {
        deps.pendingDelta.current += delta;
        if (deps.flushHandle.current === null) {
          deps.flushHandle.current = setTimeout(
            deps.flushDelta,
            deps.DELTA_FLUSH_MS,
          );
        }
      },
      onToolEvent: (evt) => {
        deps.insertDuringStream({ kind: "tool", note: describeToolEvent(evt) });
      },
      onApprovalRequest: (request) =>
        // Never auto-approve runCommand: shell execution has no path containment.
        deps.autoApproveRef.current && request.tool !== "runCommand"
          ? Promise.resolve(true)
          : new Promise<boolean>((resolve) => {
              deps.setApproval({ request, resolve });
            }),
    });
  } catch (err) {
    // A cancel can throw AbortError instead of ending cleanly — not a failure
    // to report; the finally block leaves the "cancelled" note.
    if (!controller.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.addSystemMessage(`error: ${msg}`, "error");
    }
  } finally {
    const cancelled = controller.signal.aborted;
    deps.abortRef.current = null;
    // Settle a question left parked by an errored turn, so its tool promise
    // never dangles and no ghost popup lingers.
    if (deps.askUserResolve.current) {
      deps.settleUserAnswer("(the question was cancelled)");
    }
    // Flush before settling so no buffered output is lost.
    deps.flushDelta();
    deps.setIsStreaming(false);
    deps.setEntries((prev) => closeTurn(prev, produced, cancelled));
    // So a cancelled turn reads as deliberate, not as output that stopped.
    if (cancelled) {
      deps.addSystemMessage("response cancelled", "warn");
    }
  }
}
