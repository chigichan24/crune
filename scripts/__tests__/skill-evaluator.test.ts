import { describe, it, expect } from "vitest";
import {
  validateStructure,
  extractFrontmatter,
  extractFirstJsonObject,
  buildRubricPrompt,
  evaluateSkill,
  smokeFireTest,
  toSkillEvaluation,
  shouldRetrySynthesis,
  type EvaluationResult,
} from "../skill-evaluator.js";

const goodSkill = `---
name: refactor-tests
description: Use when the user wants to refactor a Vitest suite to use shared fixtures. Triggers on phrases like "refactor tests" or "extract fixture".
allowed-tools: [Read, Edit, Bash]
---

## Overview
Refactors Vitest tests to share fixtures.

## When to Use
When tests duplicate setup logic.

## Workflow
1. Read failing test files.
2. Extract fixtures.
3. Run vitest.
`;

describe("validateStructure", () => {
  it("accepts well-formed frontmatter", () => {
    const result = validateStructure(goodSkill);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.parsed?.name).toBe("refactor-tests");
    expect(result.parsed?.allowedTools).toEqual(["Read", "Edit", "Bash"]);
  });

  it("flags missing name", () => {
    const md = `---
description: Long enough description for the validator triggers and hints.
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing description", () => {
    const md = `---
name: my-skill
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "description")).toBe(true);
  });

  it("flags oversize description (>500 chars)", () => {
    const longDesc = "x".repeat(501);
    const md = `---
name: my-skill
description: ${longDesc}
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "description" && /500/.test(i.message))).toBe(
      true
    );
  });

  it("flags too-short description (<20 chars)", () => {
    const md = `---
name: my-skill
description: short
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "description")).toBe(true);
  });

  it("flags forbidden characters in name", () => {
    const md = `---
name: My_Skill!
description: A reasonable description with enough detail to pass minimum length check.
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags malformed YAML — missing closing ---", () => {
    const md = `---
name: my-skill
description: A reasonable description with enough detail to pass minimum length check.

body without closing fence
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues[0].field).toBe("frontmatter");
    expect(result.issues[0].message).toMatch(/closing/);
  });

  it("flags malformed YAML — no frontmatter at all", () => {
    const md = `# Just a heading\n\nNo frontmatter here.`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues[0].field).toBe("frontmatter");
  });

  it("flags malformed YAML — bad scalar line", () => {
    const md = `---
name: ok-name
this line has no colon
description: A reasonable description with enough detail to pass minimum length check.
---

body
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues[0].field).toBe("frontmatter");
  });

  it("flags empty body after frontmatter", () => {
    const md = `---
name: my-skill
description: A reasonable description with enough detail to pass minimum length check.
---

`;
    const result = validateStructure(md);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "body")).toBe(true);
  });

  it("accepts body when file ends without trailing newline after closing fence", () => {
    // No trailing newline after the body and no blank line between fence
    // and body — previously misreported as "empty body".
    const md =
      "---\nname: my-skill\ndescription: A reasonable description with enough detail to pass minimum length check.\n---\nbody content";
    const result = validateStructure(md);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts indented list form for allowed-tools", () => {
    const md = `---
name: my-skill
description: A reasonable description with enough detail to pass minimum length check.
allowed-tools:
  - Read
  - Edit
---

body content
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(true);
    expect(result.parsed?.allowedTools).toEqual(["Read", "Edit"]);
  });

  it("accepts requires/next workflow-continuation arrays", () => {
    const md = `---
name: deploy-app
description: Use when the user wants to deploy the staging environment after running tests.
requires: [setup-env]
next: [smoke-test]
---

deploy steps
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(true);
    expect(result.parsed?.requires).toEqual(["setup-env"]);
    expect(result.parsed?.next).toEqual(["smoke-test"]);
  });

  // Regression for #64: the synthesizer emits long descriptions as YAML folded
  // block scalars (`>-`); the old hand-rolled parser rejected them and forced
  // every skill's overallScore to 0.
  it("accepts a folded (>-) multi-line description", () => {
    const md = `---
name: worktree-parallel-pr-workflow
description: >-
  Use when the user asks to break work into independent PRs, fan out
  worktrees, and synthesize the results. Triggers on "split into PRs".
---

body content
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.parsed?.description).toContain("independent PRs");
    // Folded scalars join wrapped lines with spaces (no embedded newlines).
    expect(result.parsed?.description).not.toContain("\n");
  });

  it("accepts a literal (|) multi-line description", () => {
    const md = `---
name: my-skill
description: |
  Line one of the description, long enough to pass the minimum length check.
  Line two continues on a new line.
---

body content
`;
    const result = validateStructure(md);
    expect(result.valid).toBe(true);
  });
});

describe("extractFrontmatter", () => {
  it("parses simple frontmatter", () => {
    const { data } = extractFrontmatter(goodSkill);
    expect(data.name).toBe("refactor-tests");
    expect(typeof data.description).toBe("string");
  });

  it("strips quotes around values", () => {
    const md = `---
name: "quoted-name"
description: 'single quoted long enough description for the validator'
---

body
`;
    const { data } = extractFrontmatter(md);
    expect(data.name).toBe("quoted-name");
    expect(data.description).toBe("single quoted long enough description for the validator");
  });

  it("parses folded block scalars (>-) into a single-line string", () => {
    const md = `---
name: x
description: >-
  folded line one
  folded line two
---
body
`;
    const { data } = extractFrontmatter(md);
    expect(data.description).toBe("folded line one folded line two");
  });
});

describe("extractFirstJsonObject", () => {
  it("returns the first balanced JSON object", () => {
    const s = 'preamble {"score": 80, "nested": {"a": 1}} trailing';
    expect(extractFirstJsonObject(s)).toBe('{"score": 80, "nested": {"a": 1}}');
  });

  it("handles strings containing braces", () => {
    const s = '{"hint": "look at {curly} braces", "score": 50}';
    expect(extractFirstJsonObject(s)).toBe(s);
  });

  it("returns null when no object present", () => {
    expect(extractFirstJsonObject("just text")).toBeNull();
  });
});

describe("buildRubricPrompt", () => {
  it("includes the skill markdown and rubric instructions", () => {
    const prompt = buildRubricPrompt(goodSkill);
    expect(prompt).toContain("STRICT JSON");
    expect(prompt).toContain("nameQuality");
    expect(prompt).toContain("descriptionTriggering");
    expect(prompt).toContain("instructionsConcrete");
    expect(prompt).toContain("noPreambleNoise");
    expect(prompt).toContain("refactor-tests");
  });

  it("uses an enclosing fence longer than any backtick run inside the markdown", () => {
    // Skill body containing triple-backtick code blocks must not break the
    // outer fence — pick a longer fence (>=4 backticks).
    const skillWithFences = `---
name: my-skill
description: A reasonable description with enough detail to pass the minimum length check.
---

## Example

\`\`\`bash
echo "hello"
\`\`\`
`;
    const prompt = buildRubricPrompt(skillWithFences);
    // The outer fence must be at least 4 backticks long to wrap the inner ```.
    expect(prompt).toMatch(/\n````+\n[\s\S]*?\n````+\n?/);
    // The inner ``` must still be present verbatim.
    expect(prompt).toContain("```bash");
  });
});

describe("smokeFireTest", () => {
  it("returns skipped: true with a follow-up message (stub)", async () => {
    const result = await smokeFireTest(goodSkill);
    expect(result.skipped).toBe(true);
    expect(typeof result.message).toBe("string");
  });
});

describe("toSkillEvaluation (persistence mapper)", () => {
  const baseResult: EvaluationResult = {
    structural: {
      valid: true,
      issues: [{ field: "body", message: "example" }],
      parsed: { name: "x", description: "y" },
    },
    rubric: {
      ok: true,
      score: 80,
      breakdown: {
        nameQuality: 20,
        descriptionTriggering: 20,
        instructionsConcrete: 20,
        noPreambleNoise: 20,
      },
      hints: ["tighten description"],
      rawResponse: "SECRET RAW LLM OUTPUT",
    },
    smokeFiring: { skipped: true, message: "stub" },
    overallScore: 90,
  };

  it("strips rawResponse from the rubric", () => {
    const out = toSkillEvaluation(baseResult);
    expect(out.rubric).toBeDefined();
    expect("rawResponse" in (out.rubric as object)).toBe(false);
  });

  it("preserves structural, rubric scores, smokeFiring, and overallScore", () => {
    const out = toSkillEvaluation(baseResult);
    expect(out.structural.valid).toBe(true);
    expect(out.structural.issues).toEqual([{ field: "body", message: "example" }]);
    expect(out.rubric?.score).toBe(80);
    expect(out.rubric?.breakdown?.nameQuality).toBe(20);
    expect(out.rubric?.hints).toEqual(["tighten description"]);
    expect(out.smokeFiring?.skipped).toBe(true);
    expect(out.overallScore).toBe(90);
  });

  it("does not leak the structural parsed field (not part of the persistable shape)", () => {
    const out = toSkillEvaluation(baseResult);
    expect("parsed" in (out.structural as object)).toBe(false);
  });

  it("omits rubric when absent", () => {
    const out = toSkillEvaluation({
      structural: { valid: false, issues: [] },
      smokeFiring: { skipped: true },
      overallScore: 0,
    });
    expect(out.rubric).toBeUndefined();
  });

  it("carries rubric error/skipped flags without rawResponse", () => {
    const out = toSkillEvaluation({
      structural: { valid: true, issues: [] },
      rubric: { ok: false, skipped: true, error: "boom", rawResponse: "noise" },
      smokeFiring: { skipped: true },
      overallScore: 50,
    });
    expect(out.rubric?.ok).toBe(false);
    expect(out.rubric?.skipped).toBe(true);
    expect(out.rubric?.error).toBe("boom");
    expect("rawResponse" in (out.rubric as object)).toBe(false);
  });
});

describe("shouldRetrySynthesis (soft threshold)", () => {
  it("retries when score is strictly below threshold", () => {
    expect(shouldRetrySynthesis(59, 60)).toBe(true);
    expect(shouldRetrySynthesis(0, 60)).toBe(true);
  });

  it("does not retry when score meets or exceeds threshold", () => {
    expect(shouldRetrySynthesis(60, 60)).toBe(false);
    expect(shouldRetrySynthesis(90, 60)).toBe(false);
  });

  it("treats undefined score as 0 (retry)", () => {
    expect(shouldRetrySynthesis(undefined, 60)).toBe(true);
  });

  it("never retries when threshold is 0 (feature off)", () => {
    expect(shouldRetrySynthesis(0, 0)).toBe(false);
    expect(shouldRetrySynthesis(undefined, 0)).toBe(false);
  });
});

describe("evaluateSkill (orchestrator)", () => {
  it("scores 0 when structural validation fails and does not call the LLM", async () => {
    const broken = `# no frontmatter at all`;
    const result = await evaluateSkill(broken, { skipRubric: true });
    expect(result.structural.valid).toBe(false);
    expect(result.overallScore).toBe(0);
    // smoke firing is always present (stub)
    expect(result.smokeFiring.skipped).toBe(true);
    // rubric is marked skipped, never invoked
    expect(result.rubric?.skipped).toBe(true);
    expect(result.rubric?.ok).toBe(false);
  });

  it("scores 50 when structural passes but rubric is skipped", async () => {
    const result = await evaluateSkill(goodSkill, { skipRubric: true });
    expect(result.structural.valid).toBe(true);
    expect(result.overallScore).toBe(50);
    expect(result.rubric?.skipped).toBe(true);
  });

  it("does not invoke the rubric LLM when structural validation fails (even without skipRubric)", async () => {
    const broken = `# no frontmatter at all`;
    // No skipRubric: structural failure alone must short-circuit the claude -p
    // call. If the LLM were invoked this would spawn a process / hang in CI.
    const result = await evaluateSkill(broken);
    expect(result.structural.valid).toBe(false);
    expect(result.overallScore).toBe(0);
    expect(result.rubric?.skipped).toBe(true);
    expect(result.rubric?.ok).toBe(false);
  });
});
