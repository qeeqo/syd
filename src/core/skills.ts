export type Skill = {
  name: string;
  instructions: string;
};

export const MAX_SKILL_NAME = 40;
// Bounded so an invoked skill can't blow up the system prompt without limit.
export const MAX_SKILL_INSTRUCTIONS = 4000;

// Normalize every input path here so UI, tools, and config accept the same handles.
export function normalizeSkillName(raw: string): string | null {
  const slug = raw
    .trim() // removes outer whitespace
    .toLowerCase() // transforms to lowercase
    .replace(/\s+/g, "-") // replace spaces to dash
    .replace(/[^a-z0-9-]/g, "") // removes invalid chars
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0 || slug.length > MAX_SKILL_NAME) return null;
  if (!/^[a-z0-9]/.test(slug)) return null;
  return slug;
}

// Anchored to string-start or whitespace, so an email ("a@b") or a mid-word "@"
// is never read as a mention.
const MENTION_RE = /(?:^|\s)@([a-z0-9][a-z0-9-]*)/gi;

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

// Unknown mentions are ignored — @ is ordinary text, so a miss is silent.
export function findMentionedSkills(message: string, skills: Skill[]): Skill[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const out: Skill[] = [];
  for (const name of parseMentions(message)) {
    const skill = byName.get(name);
    if (skill) out.push(skill);
  }
  return out;
}

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
