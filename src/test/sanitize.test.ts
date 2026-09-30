import { describe, expect, test } from "bun:test";
import { visualizeControls } from "../sanitize";

describe("visualizeControls", () => {
  test("leaves ordinary text untouched", () => {
    expect(visualizeControls("bun test")).toBe("bun test");
    expect(visualizeControls("héllo 👋")).toBe("héllo 👋");
  });

  test("marks newlines and keeps the line break", () => {
    expect(visualizeControls("a\nb")).toBe("a⏎\nb");
  });

  test("shows C0 controls as control pictures", () => {
    expect(visualizeControls("\x1b[31mred")).toBe("␛[31mred");
    expect(visualizeControls("ding\x07")).toBe("ding␇");
    expect(visualizeControls("a\rb")).toBe("a␍b");
    expect(visualizeControls("a\tb")).toBe("a␉b");
  });

  test("shows DEL and C1 controls", () => {
    expect(visualizeControls("x\x7f")).toBe("x␡");
    expect(visualizeControls("\x9b31m")).toBe("\\x9b31m");
  });

  test("exposes newline padding in a command", () => {
    const cmd = "bun test" + "\n".repeat(3) + "echo HIDDEN";
    expect(visualizeControls(cmd)).toBe("bun test⏎\n⏎\n⏎\necho HIDDEN");
  });
});
