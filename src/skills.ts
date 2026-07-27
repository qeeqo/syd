// Skills — reusable, user-defined instructions invoked with @<name> in a
// message. Pure module: no React, no TUI, so a future headless core can share
// it (same discipline as session.ts / mcp.ts). config.ts owns persistence;
// this file owns the shape, name rules, @-mention parsing, and the system-prompt
// text a set of invoked skills turns into.

// The stored shape. `name` is the @handle (see normalizeSkillName for the rule);
// `instructions` is the body injected into the system prompt when the skill is
// invoked.
export type Skill = {
  name: string;
  instructions: string;
};

// A handle stays short enough to type after @ and to align in the palette.
export const MAX_SKILL_NAME = 40;
// The body is bounded so an invoked skill can't blow up the system prompt (and
// the token bill) without limit. Generous for real instructions.
export const MAX_SKILL_INSTRUCTIONS = 4000;

// Turn a raw title into a valid @handle, or null if nothing usable remains.
// Lowercased, spaces→hyphens, only [a-z0-9-] kept, collapsed/trimmed hyphens,
// and it must start with an alphanumeric so "@-" is never a handle. This is the
// single source of truth for what a legal skill name is — the editor, the model
// tool, and config parsing all normalize through it, so they can't disagree.
export function normalizeSkillName(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0 || slug.length > MAX_SKILL_NAME) return null;
  if (!/^[a-z0-9]/.test(slug)) return null;
  return slug;
}

// Match an @handle that starts the string or follows whitespace, so an email
// ("a@b") or a mid-word "@" is never read as a mention. The captured group is
// the bare name (already the legal charset; a trailing normalize keeps it in
// lockstep with normalizeSkillName).
const MENTION_RE = /(?:^|\s)@([a-z0-9][a-z0-9-]*)/gi;

// Every @name referenced in a message, lowercased, in first-seen order with
// duplicates dropped. Text only — it never checks whether the name is a real
// skill; findMentionedSkills does that resolution.
export function parseMentions(message: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of message.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// Resolve the @mentions in a message to the actual skills they name, in
// first-mention order. Unknown mentions (plain text that happens to look like a
// handle) are ignored — @ is ordinary text, so a miss is silent, not an error.
export function findMentionedSkills(message: string, skills: Skill[]): Skill[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const out: Skill[] = [];
  for (const name of parseMentions(message)) {
    const skill = byName.get(name);
    if (skill) out.push(skill);
  }
  return out;
}

// The system-prompt addendum for the skills invoked this turn — appended by
// chat.ts after the base prompt, so chat.ts stays the single prompt choke point.
// Empty string when nothing was invoked, so the caller can append unconditionally.
export function buildSkillPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const blocks = skills.map(
    (s) => `Skill "@${s.name}":\n${s.instructions.trim()}`,
  );
  const one = skills.length === 1;
  return (
    ` The user invoked the following skill${one ? "" : "s"} for this message` +
    ` — follow ${one ? "its" : "their"} instructions closely:\n\n` +
    blocks.join("\n\n")
  );
}
