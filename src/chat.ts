// UI-agnostic wrapper around the AI SDK's streamText. The provider registry
// (providers.ts) decides how a model id becomes a LanguageModel; this module
// stays the single choke point for the model call (tools/MCP land here later).

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
  `Use deleteFile only when the user explicitly asks to remove a file. ` +
  `File changes require the user's approval; when one is not approved, do ` +
  `not retry it — ask the user what they want instead.`;

// Appended only when the user has enabled shell access in /settings. Kept out
// of the base prompt so a model without the tool is never told to reach for it.
const SHELL_PROMPT =
  ` You can also run shell commands with runCommand — use it to run this ` +
  `project's own tooling (its linter, type check, tests, or build, e.g. ` +
  `\`bun run lint\`, \`bun run build\`, \`bun test\`) and to verify your ` +
  `changes actually work. Prefer the project's own scripts over ad-hoc ` +
  `commands. Every command needs the user's approval before it runs; when ` +
  `one is denied, do not rerun it — ask the user instead.`;

// Appended when the skill tools are wired (App always wires them). Tells the
// model that skills exist, how the user invokes them, and that it can manage
// them on request. The per-turn instructions of an *invoked* skill are added
// separately (buildSkillPrompt), after this.
const SKILLS_PROMPT =
  ` The user can define reusable "skills" — saved instructions they invoke by ` +
  `writing @<name> in a message. When the user asks you to create, change, or ` +
  `remove a skill, use saveSkill / deleteSkill (saving asks for their approval ` +
  `first). Do not treat an @name in a normal message as a command to run — the ` +
  `system already injects an invoked skill's instructions for you.`;

// Appended when the askUser tool is wired. A nudge to prefer asking over
// guessing when the request is genuinely ambiguous.
const ASK_USER_PROMPT =
  ` When a request is ambiguous or you need the user to choose between options, ` +
  `call askUser to pop up a question and wait for their answer instead of ` +
  `guessing. Don't overuse it — only when a real decision is theirs to make.`;

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
  // Tools from connected MCP servers (src/mcp.ts), already namespaced. Merged
  // into the same tools object as the local project tools. Empty/absent when no
  // servers are configured, so the local-only path is unchanged.
  mcpTools?: ToolSet;
  // Names of MCP tools that must go through the approval popup — everything from
  // a non-trusted server. Added to the built-in file tools' approval gate.
  mcpGated?: string[];
  // Whether the user has enabled shell access in /settings. When true the
  // runCommand tool is added to the tool set (and always gated); when false it
  // is absent entirely, so the model can't run commands.
  shellEnabled?: boolean;
  // The skills the user invoked in this message (@name), already resolved by
  // App. Their instructions are appended to the system prompt for this turn
  // only — invocation is per-message, not sticky.
  skills?: Skill[];
  // Opens the interactive "ask the user" popup and resolves with their answer.
  // Absent → the askUser tool is not offered (headless fail-soft).
  onAskUser?: (req: AskUserRequest) => Promise<string>;
  // Persist/list skills for the saveSkill / deleteSkill tools. Absent → those
  // tools are not offered. These are the same code paths /skills uses.
  skillActions?: SkillActions;
  // How hard the model should think, on syd's canonical scale. Absent →
  // "default", which sends no reasoning option at all (see reasoning.ts).
  reasoning?: ReasoningLevel;
  // Cancels the turn when it fires (user pressed Escape). Aborts the in-flight
  // model call and ends the approval loop; whatever streamed so far is kept.
  abortSignal?: AbortSignal;
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
  mcpTools,
  mcpGated,
  shellEnabled,
  skills,
  onAskUser,
  skillActions,
  reasoning = DEFAULT_REASONING_LEVEL,
  abortSignal,
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
  //
  // Merged (not overwritten) with the reasoning option, because on the ChatGPT
  // provider both land in the same `openai` namespace — a plain object spread
  // at the top level would drop store:false and break every OAuth turn.
  const providerOptions = mergeProviderOptions(
    providers[provider].auth === "oauth"
      ? { openai: { store: false } }
      : undefined,
    reasoningOptions(provider, reasoning),
  );

  // The interactive tools (askUser + the skill tools) are built from the
  // callbacks App wired; a missing callback simply omits its tool.
  const interactiveTools = makeInteractiveTools({ onAskUser, skillActions });

  // Local project tools, the opt-in shell tool (only when enabled), the
  // interactive tools, and any connected MCP server tools, in one object — the
  // single tools set for the whole turn. Built once; the approval loop re-calls
  // streamText but the tool wiring never changes between rounds.
  const tools: ToolSet = {
    ...projectTools,
    ...(shellEnabled ? shellTools : {}),
    ...interactiveTools,
    ...mcpTools,
  };

  // Approval gate. The three file-changing local tools always require it; the
  // shell tool (when present), the skill-writing tools (when wired), and every
  // non-trusted MCP tool are added on top. Read-only local tools, askUser (an
  // interaction, not a side effect), and tools from a trusted server are absent
  // here, so they run without a prompt.
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

  // Assemble the system prompt once (it doesn't change across approval rounds):
  // base + optional shell clause + the skill/askUser capability clauses (only
  // when their tools are wired) + this turn's invoked-skill instructions.
  let system = SYSTEM_PROMPT;
  if (shellEnabled) system += SHELL_PROMPT;
  if (skillActions) system += SKILLS_PROMPT;
  if (onAskUser) system += ASK_USER_PROMPT;
  system += buildSkillPrompt(skills ?? []);

  for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
    // A cancel that lands between rounds (after a tool result, before the next
    // model call) stops here without starting another request.
    if (abortSignal?.aborted) return;

    const result = streamText({
      model: providers[provider].resolve(model),
      system,
      messages: convo,
      providerOptions,
      abortSignal,
      tools,
      // Gated tools pause the stream with an approval request instead of
      // executing; everything else runs freely.
      toolApproval,
      // Each step is one model call; a step that requests tools triggers
      // execution and another call with the results appended. The cap is the
      // safety valve that stops a confused model from looping forever.
      stopWhen: isStepCount(10),
    });

    // Approval requests surfaced by this call; the stream ends after
    // emitting them, without executing the tools they refer to.
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
        case "abort":
          // User cancelled — the stream stops here with whatever it emitted.
          // A clean return, not an error: callers keep the partial output.
          return;
        case "error":
          // A cancel can surface as a thrown AbortError instead of an abort
          // part; treat it as a clean stop, not a failure to report.
          if (abortSignal?.aborted) return;
          // textStream used to throw these; keep that contract for callers.
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error));
      }
    }

    if (abortSignal?.aborted) return;

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
