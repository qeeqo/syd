// Local AI tools for the streamText `tools` param — the model requests a
// call, the SDK validates its arguments against inputSchema, execute runs
// here, and the result is fed back as a tool-result message. Pure module:
// no React, no UI imports, so a future headless core can reuse it as-is.

import { tool } from "ai";
import { z } from "zod";
import { structuredPatch } from "diff";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ToolNote } from "./commands/type";

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
    default:
      return { label: `${evt.tool} ${path}`.trim() };
  }
}
