// UI-agnostic wrapper around the AI SDK's streamText. The provider registry
// (providers.ts) decides how a model id becomes a LanguageModel; this module
// stays the single choke point for the model call (tools/MCP land here later).

import {
  streamText,
  isStepCount,
  type ModelMessage,
  type ToolApprovalResponse,
} from "ai";
import { providers, type ProviderId } from "./providers";
import { ensureProviderReady } from "./auth";
import {
  projectTools,
  previewToolCall,
  type ToolEvent,
} from "./tools";
import type { ToolNote } from "./commands/type";

// Without this the model tends to answer questions about "the code" from
// general knowledge instead of looking — it has to be told the tools operate
// on a real directory it is sitting in.
const SYSTEM_PROMPT =
  `You are syd, a coding assistant running inside a terminal in the ` +
  `directory ${process.cwd()}. You have tools to list, read, and modify ` +
  `the files of this project. When the user asks about "the code", "this ` +
  `project", or any file, use the tools to look at the real files before ` +
  `answering — do not guess. Start with listFiles at '.' if you don't know ` +
  `the layout. Before changing a file, readFile it first and make the ` +
  `smallest edit that does the job with editFile; reserve writeFile for ` +
  `new files. Never rewrite a file wholesale to make a small change. ` +
  `File changes require the user's approval; when one is not approved, do ` +
  `not retry it — ask the user what they want instead.`;

// A write the model wants to make, awaiting the user's decision. `note` is
// the preview (label + diff) of what would change; null means the call will
// fail validation without touching disk, so there is no change to review.
export type ApprovalRequest = {
  tool: string;
  input: unknown;
  note: ToolNote | null;
};

export type StreamChatArgs = {
  provider: ProviderId;
  model: string;
  messages: ModelMessage[];
  onDelta: (chunk: string) => void;
  // Fired once per completed tool execution (or tool crash) during the
  // turn's tool loop, in stream order relative to text deltas.
  onToolEvent?: (evt: ToolEvent) => void;
  // Asked once per file-changing tool call, before it executes. Resolve
  // true to allow the write, false to deny it. Absent → all writes are
  // denied (fail closed for headless embedders that forget to wire it).
  onApprovalRequest?: (req: ApprovalRequest) => Promise<boolean>;
};

// Rounds of the outer approve-and-resume loop, on top of the per-call step
// cap. Only a model that keeps requesting writes after denials hits this.
const MAX_APPROVAL_ROUNDS = 8;

export async function streamChat({
  provider,
  model,
  messages,
  onDelta,
  onToolEvent,
  onApprovalRequest,
}: StreamChatArgs) {
  // Refresh OAuth credentials before the first call so resolve() reads a live
  // token (no-op for key providers). A failure here throws to the caller,
  // which surfaces it and lets the user re-authenticate.
  await ensureProviderReady(provider);

  // The conversation grows across approval rounds: each round appends the
  // model's own output plus the user's approval decisions, then re-calls.
  const convo: ModelMessage[] = [...messages];

  // The ChatGPT backend rejects any request that doesn't explicitly set
  // store:false (the SDK omits it by default). This provider option is scoped
  // to the OpenAI provider namespace, so it's inert for Google/Anthropic and
  // for the real api.openai.com provider it's a harmless no-persist request.
  const providerOptions =
    providers[provider].auth === "oauth"
      ? { openai: { store: false } }
      : undefined;

  for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
    const result = streamText({
      model: providers[provider].resolve(model),
      system: SYSTEM_PROMPT,
      messages: convo,
      providerOptions,
      tools: projectTools,
      // File-changing tools pause the stream with an approval request
      // instead of executing; read-only tools run freely.
      toolApproval: {
        editFile: "user-approval",
        writeFile: "user-approval",
      },
      // Each step is one model call; a step that requests tools triggers
      // execution and another call with the results appended. The cap is the
      // safety valve that stops a confused model from looping forever.
      stopWhen: isStepCount(10),
    });

    // Approval requests surfaced by this call; the stream ends after
    // emitting them, without executing the tools they refer to.
    const pending: { approvalId: string; tool: string; input: unknown }[] = [];

    // fullStream instead of textStream: same text deltas, plus the tool-loop
    // events between them. Unknown part types fall through — new SDK part
    // kinds must not break streaming.
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          onDelta(part.text);
          break;
        case "tool-result":
          onToolEvent?.({
            phase: "result",
            tool: part.toolName,
            input: part.input,
            output: part.output,
          });
          break;
        case "tool-error":
          onToolEvent?.({
            phase: "error",
            tool: part.toolName,
            input: part.input,
            output: part.error,
          });
          break;
        case "tool-approval-request":
          // Automatic approvals/denials are policy decisions already made;
          // only genuine user-approval requests need a human.
          if (!part.isAutomatic) {
            pending.push({
              approvalId: part.approvalId,
              tool: part.toolCall.toolName,
              input: part.toolCall.input,
            });
          }
          break;
        case "error":
          // textStream used to throw these; keep that contract for callers.
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error));
      }
    }

    // No pending approvals → the model finished its turn normally.
    if (pending.length === 0) return;

    // Resume protocol: extend the conversation with everything the model
    // produced this round, answer each request, and call again — approved
    // tools execute on the next round.
    convo.push(...(await result.responseMessages));

    const responses: ToolApprovalResponse[] = [];
    for (const req of pending) {
      const approved = onApprovalRequest
        ? await onApprovalRequest({
            tool: req.tool,
            input: req.input,
            note: await previewToolCall(req.tool, req.input),
          })
        : false;
      responses.push({
        type: "tool-approval-response",
        approvalId: req.approvalId,
        approved,
        ...(approved ? {} : { reason: "The user declined this change." }),
      });
    }
    convo.push({ role: "tool", content: responses });
  }
}
