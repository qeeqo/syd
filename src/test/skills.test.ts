import { test, describe, expect } from "bun:test";
import { normalizeSkillName, MAX_SKILL_NAME } from "../skills";

describe("normalizeSkillName", () => {
  test("is idempotent for normalized skill names", () => {
    for (const input of ["My SkilL", " hello ", "@sill", "--skill"]) {
      const once = normalizeSkillName(input);
      expect(normalizeSkillName(once!)).toBe(once!);
    }
  });
  test("rejects names longer than the limit", () => {
    expect(normalizeSkillName("a".repeat(MAX_SKILL_NAME + 1))).toBeNull();
  });
});
