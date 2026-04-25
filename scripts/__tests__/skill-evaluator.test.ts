import { describe, it, expect } from "vitest";
import {
  validateStructure,
  extractFrontmatter,
  extractFirstJsonObject,
  buildRubricPrompt,
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
});
