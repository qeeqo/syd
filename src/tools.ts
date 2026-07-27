// Local AI tools for the streamText `tools` param — the model requests a
// call, the SDK validates its arguments against inputSchema, execute runs
// here, and the result is fed back as a tool-result message. Pure module:
// no React, no UI imports, so a future headless core can reuse it as-is.

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { structuredPatch } from "diff";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ToolNote } from "./commands/type";
import {
  normalizeSkillName,
  MAX_SKILL_INSTRUCTIONS,
  type Skill,
} from "./skills";

// Everything the model touches must stay inside the project. resolve()
// collapses any ../ segments, so a prefix check on the result is sufficient —
// checking the raw input string would miss "src/../../secrets".
function insideProject(path: string): string | null {
  const root = process.cwd();
  const abs = resolve(root, path);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

// Dependency and VCS internals are huge and never what the user is asking
// about — letting the model wander in burns tokens for nothing.
const BLOCKED = new Set(["node_modules", ".git"]);

function isBlocked(abs: string): boolean {
  return abs.split(sep).some((part) => BLOCKED.has(part));
}

// A whole-file dump bigger than this is almost certainly a lockfile or asset,
// not source — and it would swamp the context window in one call.
const MAX_FILE_BYTES = 200_000;

// Build a unified diff (the ---/+++/@@ format) by comparing the whole old and
// new file contents. jsdiff's structuredPatch runs a real line diff, so only
// changed lines are marked -/+ and unchanged neighbours become context — an
// overwrite that touches one line no longer renders as a full-file churn.
// Returns "" when nothing changed. The output starts at ---/+++ (jsdiff's own
// Index/=== header is skipped), matching what OpenTUI's <diff> parses.
function unifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
): string {
  const { hunks } = structuredPatch(path, path, oldContent, newContent, "", "", {
    context: 3,
  });
  if (hunks.length === 0) return "";
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    // hunk lines are already prefixed with ' ', '-', or '+' by jsdiff.
    out.push(...h.lines);
  }
  return out.join("\n");
}

// Write-tool results are objects: `summary` is what the transcript shows and
// the model reads back; `diffText` is consumed by the UI's diff renderer.
type WriteResult = { summary: string; diffText: string };

// A validated-but-not-applied write. Both the approval preview and the
// actual execution derive from the same plan, so what the user approves is
// exactly what gets written — the preview can never drift from the effect.
type WritePlan =
  | { ok: false; error: string }
  | {
      ok: true;
      abs: string;
      // The complete file content the plan would leave on disk.
      next: string;
      // Past tense, for the transcript after the write happens.
      summary: string;
      // Present tense, for the approval popup before it happens.
      proposal: string;
      diffText: string;
    };

async function planEdit(
  path: string,
  oldText: string,
  newText: string,
): Promise<WritePlan> {
  const abs = insideProject(path);
  if (!abs) return { ok: false, error: `error: ${path} is outside the project directory` };
  if (isBlocked(abs)) return { ok: false, error: `error: ${path} is not editable` };
  if (oldText === "") {
    return {
      ok: false,
      error: "error: oldText must not be empty — use writeFile for new files",
    };
  }
  const file = Bun.file(abs);
  if (!(await file.exists())) {
    return {
      ok: false,
      error: `error: ${path} does not exist (use writeFile to create it)`,
    };
  }
  const content = await file.text();
  const at = content.indexOf(oldText);
  if (at === -1) {
    return {
      ok: false,
      error:
        `error: oldText not found in ${path} — the file may have ` +
        `changed; readFile it again and copy the text exactly`,
    };
  }
  if (content.indexOf(oldText, at + 1) !== -1) {
    return {
      ok: false,
      error:
        `error: oldText appears more than once in ${path} — include ` +
        `more surrounding lines to make it unique`,
    };
  }
  const startLine = content.slice(0, at).split("\n").length;
  const oldLines = oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  const change = `(-${oldLines.length} +${newLines.length} at line ${startLine})`;
  const next = content.slice(0, at) + newText + content.slice(at + oldText.length);
  return {
    ok: true,
    abs,
    next,
    summary: `edited ${path} ${change}`,
    proposal: `edit ${path} ${change}`,
    diffText: unifiedDiff(path, content, next),
  };
}

async function planWrite(path: string, content: string): Promise<WritePlan> {
  const abs = insideProject(path);
  if (!abs) return { ok: false, error: `error: ${path} is outside the project directory` };
  if (isBlocked(abs)) return { ok: false, error: `error: ${path} is not writable` };
  const existed = await Bun.file(abs).exists();
  // Overwrites diff against what was actually there, so the transcript
  // shows what was lost — not just the new content.
  const oldContent = existed ? await Bun.file(abs).text() : "";
  const oldLines = oldContent === "" ? [] : oldContent.split("\n");
  const newLines = content === "" ? [] : content.split("\n");
  return {
    ok: true,
    abs,
    next: content,
    summary: existed
      ? `overwrote ${path} (${newLines.length} lines)`
      : `created ${path} (${newLines.length} lines)`,
    proposal: existed
      ? `overwrite ${path} (${newLines.length} lines, replacing ${oldLines.length})`
      : `create ${path} (${newLines.length} lines)`,
    diffText: unifiedDiff(path, oldContent, content),
  };
}

// A validated-but-not-applied delete. Like WritePlan, the approval preview and
// the actual removal both derive from this, so what the user approves is
// exactly what gets deleted. diffText renders the file as all-red (its content
// diffed against empty) so the popup shows what's being lost.
type DeletePlan =
  | { ok: false; error: string }
  | {
      ok: true;
      abs: string;
      summary: string;
      proposal: string;
      diffText: string;
    };

async function planDelete(path: string): Promise<DeletePlan> {
  const abs = insideProject(path);
  if (!abs) return { ok: false, error: `error: ${path} is outside the project directory` };
  if (isBlocked(abs)) return { ok: false, error: `error: ${path} is not deletable` };
  let info;
  try {
    info = await stat(abs);
  } catch {
    return { ok: false, error: `error: ${path} does not exist` };
  }
  // Only files. A directory delete would be recursive and far more dangerous,
  // and there's no meaningful single diff to preview for one.
  if (!info.isFile()) {
    return {
      ok: false,
      error: `error: ${path} is not a file — deleteFile only removes files`,
    };
  }
  // Skip the red diff for oversized files (lockfiles, assets): a huge wall of
  // red helps no one and could swamp the popup. Fall back to a byte count.
  const big = info.size > MAX_FILE_BYTES;
  const oldContent = big ? "" : await Bun.file(abs).text();
  const lineCount = oldContent === "" ? 0 : oldContent.split("\n").length;
  const change = big ? `(${info.size} bytes)` : `(${lineCount} lines)`;
  return {
    ok: true,
    abs,
    summary: `deleted ${path} ${change}`,
    proposal: `delete ${path} ${change}`,
    diffText: big ? "" : unifiedDiff(path, oldContent, ""),
  };
}

// Tool results are plain strings, including errors. A returned "error: ..."
// goes back into the loop where the model can read it and self-correct
// (retry another path, ask the user) — a thrown error would end the turn.
export const projectTools = {
  listFiles: tool({
    description:
      "List the entries of a directory in the user's project. " +
      "Directories are suffixed with '/'. Use this to orient yourself " +
      "before reading files.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Directory path relative to the project root, '.' for root"),
    }),
    execute: async ({ path }) => {
      const abs = insideProject(path);
      if (!abs) return `error: ${path} is outside the project directory`;
      if (isBlocked(abs)) return `error: ${path} is not browsable`;
      try {
        const entries = await readdir(abs, { withFileTypes: true });
        const listing = entries
          .filter((e) => !BLOCKED.has(e.name))
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
          .sort();
        return listing.length > 0 ? listing.join("\n") : "(empty directory)";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),

  readFile: tool({
    description:
      "Read the full contents of a file in the user's project. " +
      "Prefer listFiles first if you are unsure a path exists.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the project root"),
    }),
    execute: async ({ path }) => {
      const abs = insideProject(path);
      if (!abs) return `error: ${path} is outside the project directory`;
      if (isBlocked(abs)) return `error: ${path} is not readable`;
      try {
        const file = Bun.file(abs);
        if (!(await file.exists())) {
          return `error: ${path} does not exist (try listFiles)`;
        }
        if (file.size > MAX_FILE_BYTES) {
          return `error: ${path} is ${file.size} bytes — too large to read`;
        }
        return await file.text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),

  editFile: tool({
    description:
      "Modify a file by replacing an exact snippet of its current text. " +
      "oldText must be copied exactly from readFile output (including " +
      "indentation and line breaks) and must appear exactly once in the " +
      "file — include surrounding lines to make it unique. Prefer whole " +
      "lines. An empty newText deletes the snippet. Always readFile before " +
      "editing; never edit from memory.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the project root"),
      oldText: z
        .string()
        .describe("Exact existing text to replace — must be unique"),
      newText: z
        .string()
        .describe("Replacement text; empty string deletes oldText"),
    }),
    execute: async ({ path, oldText, newText }) => {
      try {
        const plan = await planEdit(path, oldText, newText);
        if (!plan.ok) return plan.error;
        await Bun.write(plan.abs, plan.next);
        const result: WriteResult = {
          summary: plan.summary,
          diffText: plan.diffText,
        };
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),

  writeFile: tool({
    description:
      "Create a new file, or fully overwrite an existing one, with the " +
      "given content. Parent directories are created as needed. For small " +
      "targeted changes to an existing file prefer editFile.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the project root"),
      content: z.string().describe("The complete file content to write"),
    }),
    execute: async ({ path, content }) => {
      try {
        const plan = await planWrite(path, content);
        if (!plan.ok) return plan.error;
        await Bun.write(plan.abs, plan.next);
        const result: WriteResult = {
          summary: plan.summary,
          diffText: plan.diffText,
        };
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),

  deleteFile: tool({
    description:
      "Delete a file from the user's project. Use only when the user " +
      "explicitly asks to remove a file — to clear part of a file's contents " +
      "use editFile instead. Requires the user's approval and cannot be undone.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the project root"),
    }),
    execute: async ({ path }) => {
      try {
        const plan = await planDelete(path);
        if (!plan.ok) return plan.error;
        await unlink(plan.abs);
        const result: WriteResult = {
          summary: plan.summary,
          diffText: plan.diffText,
        };
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),
};

// --- Shell tool -------------------------------------------------------------
// A single "run a command" tool, kept separate from projectTools because it is
// opt-in: chat.ts only merges it into the tool set when the user has enabled
// shell access in /settings. Unlike the file tools it has NO path-containment
// safety net — a shell interprets the whole string, so `cd ..`, `curl | sh`,
// and reading files outside the project are all reachable. Its entire safety
// story is therefore the approval popup (the exact command is shown) plus the
// runtime guards below; it is always gated and never covered by auto-approve.

// How much command output is fed back to the model / shown. A long test log
// shouldn't swamp the context window, so we keep only the TAIL — build and test
// tools print their errors and summaries last.
const MAX_OUTPUT_BYTES = 100_000;

// Hard ceiling on run time. A hung server or an accidental infinite loop can't
// wedge the turn forever — the child is killed once this elapses.
const SHELL_TIMEOUT_MS = 120_000;

// Last-resort valve against runaway output (e.g. an infinite `yes`): once a
// command emits this many bytes we kill it (see readPipe's overflow path), so
// an endless producer can't accumulate unbounded memory before the timeout
// fires. Far above any legitimate build or test log, so normal runs are
// untouched — only genuinely unbounded ones die.
const SHELL_MAX_BUFFER = 10_000_000;

// How long, after the process exits, we keep draining its pipes before forcing
// them closed. A killed command can leave an orphaned grandchild holding the
// pipe open (e.g. `sh` is killed but its `sleep` child lingers); without this
// grace-then-cancel the read would block until that grandchild also exits,
// making Escape feel unresponsive. Long enough to catch a fast child's final
// buffered bytes, short enough that cancellation is effectively immediate.
const DRAIN_GRACE_MS = 150;

// Read a process pipe into byte chunks until EOF, cancellation, or the running
// total exceeds `cap` — at which point it calls onOverflow (used to kill a
// runaway producer) and stops. Returns a handle whose `done` promise settles
// when reading finishes and whose `cancel` force-stops a read that's blocked
// waiting on EOF. Never throws: a cancelled/errored read resolves what it has.
function readPipe(
  stream: ReadableStream<Uint8Array>,
  cap: number,
  onOverflow: () => void,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;
  const done = (async () => {
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(value);
        total += value.length;
        if (total > cap && !overflowed) {
          overflowed = true;
          onOverflow();
        }
      }
    } catch {
      // Cancelled or the stream errored — keep whatever we collected.
    } finally {
      reader.releaseLock();
    }
  })();
  return {
    done,
    cancel: () => void reader.cancel().catch(() => {}),
    text: () => new TextDecoder().decode(concatChunks(chunks, total)),
  };
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// Keep only the last `max` characters, marking the cut so the model knows text
// was dropped. Length is a close-enough proxy for bytes here — this is a safety
// cap, not an exact budget.
function tailClamp(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `…[${text.length - max} earlier characters truncated]\n${text.slice(-max)}`,
    truncated: true,
  };
}

// The result of a runCommand call. Returned as an object (like WriteResult) so
// the model reads structured output and describeToolEvent can build a transcript
// label from it. A non-zero exitCode is a normal outcome, not an error.
export type ShellResult = {
  command: string;
  // null when the process was killed by a signal (timeout / abort / maxBuffer)
  // rather than exiting on its own.
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
};

export const shellTools = {
  runCommand: tool({
    description:
      "Run a shell command in the project's root directory and return its " +
      "stdout, stderr, and exit code. Use this to run the project's own " +
      "tooling — linters, type checks, tests, build steps (e.g. `bun run " +
      "lint`, `bun run build`, `bun test`) — and read-only inspection " +
      "commands. Runs via `sh -c` with stdin closed, so never use an " +
      "interactive command that waits for input. A non-zero exit code is a " +
      "normal result, not an error — read stderr to see what failed. Every " +
      "command requires the user's approval before it runs; if one is denied, " +
      "do not rerun it — ask the user what they want instead.",
    inputSchema: z.object({
      command: z
        .string()
        .describe("The shell command line to run, e.g. 'bun run lint'"),
    }),
    execute: async (
      { command },
      { abortSignal },
    ): Promise<ShellResult | string> => {
      const trimmed = command.trim();
      if (trimmed === "") return "error: command must not be empty";
      try {
        const proc = Bun.spawn(["sh", "-c", trimmed], {
          cwd: process.cwd(),
          stdin: "ignore", // never block waiting on interactive input
          stdout: "pipe",
          stderr: "pipe",
          signal: abortSignal, // Escape/cancel kills the child too
          timeout: SHELL_TIMEOUT_MS,
          killSignal: "SIGKILL",
        });
        // Drain both pipes concurrently so a child that fills a pipe buffer can
        // keep writing (reading only after exit would deadlock on large output).
        // A running total over SHELL_MAX_BUFFER kills a runaway producer — the
        // portable guard, not relying on the spawn-level maxBuffer option.
        const kill = () => proc.kill("SIGKILL");
        const out = readPipe(proc.stdout, SHELL_MAX_BUFFER, kill);
        const err = readPipe(proc.stderr, SHELL_MAX_BUFFER, kill);
        // Wait for the process itself, not for pipe EOF: an orphaned grandchild
        // can hold the pipe open past the child's death. After exit we give the
        // pipes a brief grace to flush, then force the readers closed so a
        // lingering grandchild can never wedge the turn.
        await proc.exited;
        await Promise.race([
          Promise.all([out.done, err.done]),
          Bun.sleep(DRAIN_GRACE_MS),
        ]);
        out.cancel();
        err.cancel();
        await Promise.all([out.done, err.done]);
        const outClamped = tailClamp(out.text(), MAX_OUTPUT_BYTES);
        const errClamped = tailClamp(err.text(), MAX_OUTPUT_BYTES);
        // exitCode is null when the process was killed by a signal. An abort is
        // the user cancelling; otherwise a signal-kill here means the timeout
        // (or the output-cap kill) fired.
        const aborted = abortSignal?.aborted ?? false;
        const timedOut = proc.exitCode === null && !aborted;
        return {
          command: trimmed,
          exitCode: proc.exitCode,
          timedOut,
          aborted,
          truncated: outClamped.truncated || errClamped.truncated,
          stdout: outClamped.text,
          stderr: errClamped.text,
        };
      } catch (err) {
        // A pre-aborted signal makes spawn throw — report it as a clean cancel
        // rather than a tool failure.
        if (abortSignal?.aborted) return "error: command cancelled";
        const msg = err instanceof Error ? err.message : String(err);
        return `error: ${msg}`;
      }
    },
  }),
};

// --- Interactive tools ------------------------------------------------------
// Tools that reach back into the running app rather than only touching disk:
// `askUser` pops up a question and waits for the answer, and the two skill tools
// let the model create/remove skills on request. They can't be static like the
// file tools (they need callbacks into App's state + popups), so a factory
// closes over the injected handlers. chat.ts builds these per-turn from what
// App provides and merges the result into the same `tools` object. A handler
// left out simply omits its tool — the fail-soft path for a headless embedder
// that doesn't wire them.

// What the model wants to ask the user. `options` are selectable labels;
// `allowInput` also offers a free-text answer. Surfaced to App, which renders
// the popup and resolves with the chosen/typed string.
export type AskUserRequest = {
  question: string;
  options: string[];
  allowInput: boolean;
};

// The skill operations App exposes to the model tools: `save` persists a skill
// (and updates live state), `remove` deletes one (false if absent), `list`
// returns the current skills so the model can read what already exists. All are
// the same code paths the /skills popup uses, so tool-driven and popup-driven
// edits stay consistent.
export type SkillActions = {
  save: (skill: Skill) => Promise<void>;
  remove: (name: string) => Promise<boolean>;
  list: () => Skill[];
};

export type InteractiveDeps = {
  onAskUser?: (req: AskUserRequest) => Promise<string>;
  skillActions?: SkillActions;
};

export function makeInteractiveTools(deps: InteractiveDeps): ToolSet {
  const tools: ToolSet = {};

  if (deps.onAskUser) {
    const onAskUser = deps.onAskUser;
    tools.askUser = tool({
      description:
        "Ask the user a question and wait for their answer, shown as a popup " +
        "with selectable options. Use this whenever you need the user to make " +
        "a choice or clarify something before proceeding, instead of guessing " +
        "or assuming. Give a few short, distinct options; set allowInput to " +
        "also let them type a free-form answer. Returns the user's answer as " +
        "text (or a note if they dismissed it without answering).",
      inputSchema: z.object({
        question: z.string().describe("The question to put to the user"),
        options: z
          .array(z.string())
          .describe(
            "Selectable answers, each a short label. May be empty when you only want free text.",
          ),
        allowInput: z
          .boolean()
          .optional()
          .describe("Also let the user type a custom answer"),
      }),
      execute: async ({ question, options, allowInput }) => {
        const q = question.trim();
        if (!q) return "error: question must not be empty";
        const opts = (options ?? []).map((o) => o.trim()).filter(Boolean);
        const allow = allowInput ?? false;
        if (opts.length === 0 && !allow) {
          return "error: provide at least one option, or set allowInput to accept free text";
        }
        return await onAskUser({ question: q, options: opts, allowInput: allow });
      },
    });
  }

  if (deps.skillActions) {
    const skillActions = deps.skillActions;
    tools.saveSkill = tool({
      description:
        "Create or update a reusable skill — saved instructions the user can " +
        "later invoke by writing @<name> in a message. Use this when the user " +
        "asks you to make, save, or change a skill. Pick a short, memorable, " +
        "lowercase name. Requires the user's approval before it is saved.",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Short skill handle, e.g. 'review' — invoked as @review"),
        instructions: z
          .string()
          .describe("What syd should do when this skill is invoked"),
      }),
      execute: async ({ name, instructions }) => {
        const normalized = normalizeSkillName(name);
        if (!normalized) {
          return `error: "${name}" is not a valid skill name — use letters, numbers, and hyphens`;
        }
        const body = instructions.trim();
        if (!body) return "error: instructions must not be empty";
        if (body.length > MAX_SKILL_INSTRUCTIONS) {
          return `error: instructions are too long (max ${MAX_SKILL_INSTRUCTIONS} characters)`;
        }
        try {
          const existed = skillActions.list().some((s) => s.name === normalized);
          await skillActions.save({ name: normalized, instructions: body });
          const summary = `${existed ? "updated" : "created"} skill @${normalized}`;
          const result: { summary: string } = { summary };
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `error: ${msg}`;
        }
      },
    });

    tools.deleteSkill = tool({
      description:
        "Delete a saved skill by name. Use only when the user asks to remove a " +
        "skill. Requires the user's approval.",
      inputSchema: z.object({
        name: z.string().describe("The skill handle to delete, e.g. 'review'"),
      }),
      execute: async ({ name }) => {
        const normalized = normalizeSkillName(name) ?? name.trim().toLowerCase();
        try {
          const removed = await skillActions.remove(normalized);
          if (!removed) return `error: no skill named @${normalized}`;
          const result: { summary: string } = {
            summary: `deleted skill @${normalized}`,
          };
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `error: ${msg}`;
        }
      },
    });
  }

  return tools;
}

// Preview what a write-tool call would do, without doing it — shown in the
// approval popup. Returns null when there is nothing meaningful to preview:
// non-write tools, malformed input, or a plan that fails validation (that
// call is doomed to return its error string without touching disk, so
// there's no change to approve).
export async function previewToolCall(
  toolName: string,
  input: unknown,
): Promise<ToolNote | null> {
  const i = input as Record<string, unknown> | null;
  if (
    toolName === "editFile" &&
    typeof i?.path === "string" &&
    typeof i?.oldText === "string" &&
    typeof i?.newText === "string"
  ) {
    const plan = await planEdit(i.path, i.oldText, i.newText);
    return plan.ok ? { label: plan.proposal, diffText: plan.diffText } : null;
  }
  if (
    toolName === "writeFile" &&
    typeof i?.path === "string" &&
    typeof i?.content === "string"
  ) {
    const plan = await planWrite(i.path, i.content);
    return plan.ok ? { label: plan.proposal, diffText: plan.diffText } : null;
  }
  if (toolName === "deleteFile" && typeof i?.path === "string") {
    const plan = await planDelete(i.path);
    return plan.ok ? { label: plan.proposal, diffText: plan.diffText } : null;
  }
  // The shell tool has no diff to preview — the command string itself is the
  // thing being authorized, so surface it in the label. The popup shows this
  // prominently instead of the raw JSON args.
  if (toolName === "runCommand" && typeof i?.command === "string") {
    const cmd = i.command.trim();
    return cmd ? { label: `run \`${cmd}\`` } : null;
  }
  // Saving a skill: show the body as an all-green diff so the approval popup
  // reveals exactly what will be stored (not just the name). We diff against ""
  // — the plan has no access to the existing skill here — so an update shows the
  // full new instructions rather than only the delta, which is the part that
  // matters when deciding to approve.
  if (
    toolName === "saveSkill" &&
    typeof i?.name === "string" &&
    typeof i?.instructions === "string"
  ) {
    const normalized = normalizeSkillName(i.name);
    const body = i.instructions.trim();
    if (!normalized || !body) return null;
    return {
      label: `save skill @${normalized}`,
      diffText: unifiedDiff(`@${normalized}`, "", body),
    };
  }
  if (toolName === "deleteSkill" && typeof i?.name === "string") {
    const normalized = normalizeSkillName(i.name) ?? i.name.trim().toLowerCase();
    return normalized ? { label: `delete skill @${normalized}` } : null;
  }
  return null;
}

// One tool-loop event, as surfaced by streamChat's fullStream: the SDK ran a
// tool and produced output ("result"), or the tool threw ("error").
export type ToolEvent = {
  phase: "result" | "error";
  tool: string;
  input: unknown;
  output: unknown;
};

// Translate a raw ToolEvent into what the transcript shows. Lives here, not
// in the UI, so knowledge of each tool's input/output shape stays in the
// module that defines the tools.
export function describeToolEvent(evt: ToolEvent): ToolNote {
  const input = evt.input as Record<string, unknown> | null;
  const path = typeof input?.path === "string" ? input.path : "";

  if (evt.phase === "error") {
    return { label: `${evt.tool} ${path} failed`.replace("  ", " ") };
  }
  // Tools report recoverable failures as "error: ..." strings — show them so
  // the user sees the model hit a wall (and watch it self-correct).
  if (typeof evt.output === "string" && evt.output.startsWith("error: ")) {
    return { label: `${evt.tool} ${path} — ${evt.output}`.replace("  ", " ") };
  }

  switch (evt.tool) {
    case "readFile":
      return { label: `read ${path}` };
    case "listFiles":
      return { label: `listed ${path === "." || path === "" ? "./" : path}` };
    case "editFile":
    case "writeFile":
    case "deleteFile": {
      const out = evt.output as Partial<WriteResult> | null;
      if (out && typeof out.summary === "string") {
        return { label: out.summary, diffText: out.diffText };
      }
      return { label: `${evt.tool} ${path}` };
    }
    case "runCommand": {
      const out = evt.output as Partial<ShellResult> | null;
      const cmd =
        (out && typeof out.command === "string" && out.command) ||
        (typeof input?.command === "string" ? input.command : "");
      if (out?.aborted) return { label: `$ ${cmd} — cancelled` };
      if (out?.timedOut) return { label: `$ ${cmd} — timed out` };
      if (out && typeof out.exitCode !== "undefined") {
        return { label: `$ ${cmd} (exit ${out.exitCode ?? "killed"})` };
      }
      return { label: `$ ${cmd}` };
    }
    case "saveSkill":
    case "deleteSkill": {
      // Both return { summary } on success (past tense, ready for the transcript).
      const out = evt.output as { summary?: unknown } | null;
      if (out && typeof out.summary === "string") return { label: out.summary };
      return { label: evt.tool };
    }
    case "askUser": {
      // input carries the question, output the user's answer string.
      const q =
        typeof input?.question === "string" ? input.question.trim() : "asked";
      const answer = typeof evt.output === "string" ? evt.output.trim() : "";
      return { label: answer ? `${q} → ${answer}` : q };
    }
    default:
      // Anything else — an MCP server tool. There's no local schema for its
      // input/output, so just record that it ran (the tool name is already
      // namespaced <server>__<tool>).
      return { label: `ran ${evt.tool}` };
  }
}
