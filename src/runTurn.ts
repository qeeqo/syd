import type { Dispatch, RefObject, SetStateAction } from "react";
import { toModelMessages, type Entry } from "./commands/type";
import { findMentionedSkills, type Skill } from "./skills";
import type { ProviderId } from "./providers";
import type { ToolSet } from "ai";
import type { ReasoningLevel } from "./reasoning";
import { streamChat, type ApprovalRequest } from "./chat";
import type { ModelMessage } from "ai";

export async function runTurn(
  message: string,
  deps: {
    entries: Entry[];
    setEntries: Dispatch<SetStateAction<Entry[]>>;
    abortRef: RefObject<AbortController | null>;
    skills: Skill[];
    provider: ProviderId;
    setProvider: Dispatch<SetStateAction<ProviderId>>;
    model: string;
    setModel: Dispatch<SetStateAction<string>>;
    shellEnabled: boolean;
    setShellEnabled: Dispatch<SetStateAction<boolean>>;
    mcpTools: ToolSet;
    mcpGated: string[];
    reasoning: ReasoningLevel;
    setReasoning: Dispatch<SetStateAction<ReasoningLevel>>;
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
      skills: deps.skills,
    });
  } catch {
  } finally {
  }
}
