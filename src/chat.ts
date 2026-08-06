import {
  streamText,
  isStepCount,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolSet,
} from "ai";
import { providers, type ProviderId } from "./providers";
import { ensureProviderReady } from "./auth";
import {
  projectTools,
  shellTools,
  makeInteractiveTools,
  previewToolCall,
  type ToolEvent,
  type AskUserRequest,
  type SkillActions,
} from "./tools";
import { buildSkillPrompt, type Skill } from "./skills";
import {
  reasoningOptions,
  mergeProviderOptions,
  DEFAULT_REASONING_LEVEL,
  type ReasoningLevel,
} from "./reasoning";
import type { ToolNote } from "./commands/type";

// Without this the model answers questions about "the code" from general
// knowledge instead of looking at the real directory it's sitting in.
const SYSTEM_PROMPT =
  `You are syd, a coding assistant running inside a terminal in the ` +
  `directory ${process.cwd()}. You have tools to list, read, and modify ` +
  `the files of this project. When the user asks about "the code", "this ` +
  `project", or any file, use the tools to look at the real files before ` +
  `answering — do not guess. Start with listFiles at '.' if you don't know ` +
  `the layout. Before changing a file, readFile it first and make the ` +
  `smallest edit that does the job with editFile; reserve writeFile for ` +
  `new files. Never rewrite a file wholesale to make a small change. ` +
  `Use deleteFile only when the user explicitly asks to remove a file. ` +
  `File changes require the user's approval; when one is not approved, do ` +
  `not retry it — ask the user what they want instead.`;

// Kept out of the base prompt so a model without the tool is never told to
// reach for it.
const SHELL_PROMPT =
  ` You can also run shell commands with runCommand — use it to run this ` +
  `project's own tooling (its linter, type check, tests, or build, e.g. ` +
  `\`bun run lint\`, \`bun run build\`, \`bun test\`) and to verify your ` +
  `changes actually work. Prefer the project's own scripts over ad-hoc ` +
  `commands. Every command needs the user's approval before it runs; when ` +
  `one is denied, do not rerun it — ask the user instead.`;

const SKILLS_PROMPT =
  ` The user can define reusable "skills" — saved instructions they invoke by ` +
  `writing @<name> in a message. When the user asks you to create, change, or ` +
  `remove a skill, use saveSkill / deleteSkill (saving asks for their approval ` +
  `first). Do not treat an @name in a normal message as a command to run — the ` +
  `system already injects an invoked skill's instructions for you.`;

const ASK_USER_PROMPT =
  ` When a request is ambiguous or you need the user to choose between options, ` +
  `call askUser to pop up a question and wait for their answer instead of ` +
  `guessing. Don't overuse it — only when a real decision is theirs to make.`;

// null means validation failed before any disk change, so nothing needs review.
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
  onToolEvent?: (evt: ToolEvent) => void;
  // Absent → all writes are denied, so a headless embedder that forgets to wire
  // it fails closed.
  onApprovalRequest?: (req: ApprovalRequest) => Promise<boolean>;
  mcpTools?: ToolSet;
  // MCP tools that must go through the approval popup — everything from a
  // non-trusted server.
  mcpGated?: string[];
  shellEnabled?: boolean;
  // Appended to the system prompt for this turn only — invocation is
  // per-message, not sticky.
  skills?: Skill[];
  // Absent → the askUser tool is not offered (headless fail-soft).
  onAskUser?: (req: AskUserRequest) => Promise<string>;
  skillActions?: SkillActions;
  reasoning?: ReasoningLevel;
  // Whatever streamed before the abort is kept.
  abortSignal?: AbortSignal;
};

// Bound repeated approval-resume requests.
const MAX_APPROVAL_ROUNDS = 8;

export async function streamChat({
  provider,
  model,
  messages,
  onDelta,
  onToolEvent,
  onApprovalRequest,
  mcpTools,
  mcpGated,
  shellEnabled,
  skills,
  onAskUser,
  skillActions,
  reasoning = DEFAULT_REASONING_LEVEL,
  abortSignal,
}: StreamChatArgs) {
  // Refresh OAuth before resolve() reads the token; key providers are a no-op.
  await ensureProviderReady(provider);

  const convo: ModelMessage[] = [...messages];

  // ChatGPT requires store:false; merge one level deep so reasoning options
  // cannot overwrite it in the shared openai namespace.
  const providerOptions = mergeProviderOptions(
    providers[provider].auth === "oauth"
      ? { openai: { store: false } }
      : undefined,
    reasoningOptions(provider, reasoning),
  );

  const interactiveTools = makeInteractiveTools({ onAskUser, skillActions });

  const tools: ToolSet = {
    ...projectTools,
    ...(shellEnabled ? shellTools : {}),
    ...interactiveTools,
    ...mcpTools,
  };

  // Exclude read-only, interactive, and trusted MCP tools from approval.
  const toolApproval: Record<string, "user-approval"> = {
    editFile: "user-approval",
    writeFile: "user-approval",
    deleteFile: "user-approval",
  };
  if (shellEnabled) toolApproval.runCommand = "user-approval";
  if (skillActions) {
    toolApproval.saveSkill = "user-approval";
    toolApproval.deleteSkill = "user-approval";
  }
  for (const name of mcpGated ?? []) toolApproval[name] = "user-approval";

  let system = SYSTEM_PROMPT;
  if (shellEnabled) system += SHELL_PROMPT;
  if (skillActions) system += SKILLS_PROMPT;
  if (onAskUser) system += ASK_USER_PROMPT;
  system += buildSkillPrompt(skills ?? []);

  for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
    // A cancel landing between rounds must not start another request.
    if (abortSignal?.aborted) return;

    const result = streamText({
      model: providers[provider].resolve(model),
      system,
      messages: convo,
      providerOptions,
      abortSignal,
      tools,
      toolApproval,
      // Safety valve against a confused model looping forever.
      stopWhen: isStepCount(10),
    });

    // The stream ends after emitting these, without executing the tools.
    const pending: { approvalId: string; tool: string; input: unknown }[] = [];

    for await (const part of result.stream) {
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
          // Automatic ones are policy decisions already made.
          if (!part.isAutomatic) {
            pending.push({
              approvalId: part.approvalId,
              tool: part.toolCall.toolName,
              input: part.toolCall.input,
            });
          }
          break;
        case "abort":
          // Clean return, not an error — callers keep the partial output.
          return;
        case "error":
          // A cancel can surface here as a thrown AbortError instead of an
          // abort part.
          if (abortSignal?.aborted) return;
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error));
      }
    }

    if (abortSignal?.aborted) return;

    if (pending.length === 0) return;

    // Resume protocol: append this round's output, answer each request, and
    // call again — approved tools execute on the next round.
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
