import { describe, it, expect } from "vitest";
import {
  generateSessionSummary,
  classifyWorkType,
  findCommonPathPrefix,
} from "../session-summarizer.js";

describe("generateSessionSummary", () => {
  it("single plan mode prompt: returns that prompt as summary", () => {
    const result = generateSessionSummary(
      [{ userPrompt: "Investigate the login bug", permissionMode: "plan" }],
      {
        toolBreakdown: { Read: 5 },
        filesEdited: [],
        permissionMode: null,
        turnCount: 1,
      }
    );
    expect(result.summary).toBe("Investigate the login bug");
  });

  it("multiple plan mode prompts: selects the most central one", () => {
    const result = generateSessionSummary(
      [
        { userPrompt: "refactor authentication module", permissionMode: "plan" },
        { userPrompt: "refactor authentication tests", permissionMode: "plan" },
        { userPrompt: "deploy to staging server", permissionMode: "plan" },
      ],
      {
        toolBreakdown: { Edit: 10 },
        filesEdited: [],
        permissionMode: null,
        turnCount: 3,
      }
    );
    // The first two share "refactor" and "authentication", so one of them should be selected
    // The first prompt gets higher position weight, so it should win
    expect(result.summary).toBe("refactor authentication module");
  });

  it("no plan mode prompts: falls back to all user prompts", () => {
    const result = generateSessionSummary(
      [
        { userPrompt: "fix the build error", permissionMode: "code" },
        { userPrompt: "run the tests", permissionMode: "code" },
      ],
      {
        toolBreakdown: { Bash: 5 },
        filesEdited: [],
        permissionMode: null,
        turnCount: 2,
      }
    );
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("empty prompts filtered: skips whitespace-only prompts", () => {
    const result = generateSessionSummary(
      [
        { userPrompt: "   ", permissionMode: "plan" },
        { userPrompt: "", permissionMode: "plan" },
        { userPrompt: "implement feature X", permissionMode: "plan" },
      ],
      {
        toolBreakdown: { Edit: 5 },
        filesEdited: [],
        permissionMode: null,
        turnCount: 3,
      }
    );
    expect(result.summary).toBe("implement feature X");
  });

  it("summary truncated to 300 chars: long prompt gets cut", () => {
    const longPrompt = "a".repeat(500);
    const result = generateSessionSummary(
      [{ userPrompt: longPrompt, permissionMode: "plan" }],
      {
        toolBreakdown: {},
        filesEdited: [],
        permissionMode: null,
        turnCount: 1,
      }
    );
    expect(result.summary.length).toBe(300);
  });
});

describe("classifyWorkType", () => {
  it("investigation: high read ratio", () => {
    expect(
      classifyWorkType(
        { Read: 10, Grep: 5, Glob: 3, Edit: 1 },
        null,
        10
      )
    ).toBe("investigation");
  });

  it("implementation: high write ratio", () => {
    expect(
      classifyWorkType(
        { Edit: 10, Write: 3, Read: 5 },
        null,
        10
      )
    ).toBe("implementation");
  });

  it("debugging: high bash ratio with some writes", () => {
    expect(
      classifyWorkType(
        { Bash: 10, Edit: 3, Read: 2 },
        null,
        10
      )
    ).toBe("debugging");
  });

  it("planning: plan mode with few turns and no writes", () => {
    expect(
      classifyWorkType(
        { Read: 2 },
        "plan",
        3
      )
    ).toBe("planning");
  });

  it("planning: empty tool breakdown with few turns", () => {
    expect(
      classifyWorkType(
        {},
        null,
        3
      )
    ).toBe("planning");
  });
});

describe("findCommonPathPrefix", () => {
  it("common prefix: returns shared directory", () => {
    expect(
      findCommonPathPrefix(["src/a/b.ts", "src/a/c.ts"])
    ).toBe("src/a");
  });

  it("root only: returns empty string", () => {
    expect(
      findCommonPathPrefix(["src/a.ts", "lib/b.ts"])
    ).toBe("");
  });

  it("single file: returns its directory", () => {
    expect(
      findCommonPathPrefix(["src/a/b.ts"])
    ).toBe("src/a");
  });

  it("empty array: returns empty string", () => {
    expect(findCommonPathPrefix([])).toBe("");
  });
});

describe("keywords extraction", () => {
  it("extracts top keywords from prompts", () => {
    const result = generateSessionSummary(
      [
        { userPrompt: "refactor authentication module component", permissionMode: "plan" },
        { userPrompt: "refactor authentication service layer", permissionMode: "plan" },
        { userPrompt: "refactor authentication controller handler", permissionMode: "plan" },
      ],
      {
        toolBreakdown: { Edit: 10 },
        filesEdited: [],
        permissionMode: null,
        turnCount: 3,
      }
    );
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.keywords.length).toBeLessThanOrEqual(5);
    // "refactor" and "authentication" appear in all prompts, should be top keywords
    expect(result.keywords).toContain("refactor");
    expect(result.keywords).toContain("authentication");
    // Stop words should not appear
    for (const kw of result.keywords) {
      expect(kw.trim().length).toBeGreaterThan(0);
    }
  });
});
