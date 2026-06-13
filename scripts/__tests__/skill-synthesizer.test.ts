import { describe, it, expect } from "vitest";
import {
  stripSynthesisPreamble,
  ensureClosingFence,
} from "../skill-synthesizer.js";
import { validateStructure } from "../skill-evaluator.js";

describe("stripSynthesisPreamble", () => {
  it("returns markdown starting at the opening fence when there is no preamble", () => {
    const md = "---\nname: x\ndescription: a long enough description here.\n---\n\n# Body\ntext\n";
    expect(stripSynthesisPreamble(md)).toBe(md);
  });

  it("strips a leading model preamble before the frontmatter", () => {
    const raw =
      "Now I have a thorough understanding.\n\n---\nname: x\ndescription: a long enough description here.\n---\n\n# Body\ntext\n";
    expect(stripSynthesisPreamble(raw)).toBe(
      "---\nname: x\ndescription: a long enough description here.\n---\n\n# Body\ntext\n"
    );
  });
});

describe("ensureClosingFence", () => {
  it("inserts a missing closing fence before the body heading", () => {
    // Regression for #64: the synthesizer emitted the opening fence + a folded
    // description but no closing fence, flowing straight into the body.
    const broken =
      "---\nname: worktree-parallel-pr-workflow\ndescription: >-\n  Use when the user asks to break work into independent PRs and fan out worktrees.\n\n# Worktree並行PR開発\n\n## Overview\nbody\n";
    const fixed = ensureClosingFence(broken);
    expect(fixed).toContain("\n---\n\n# Worktree並行PR開発");
    // The repaired document now validates structurally.
    const result = validateStructure(fixed);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.parsed?.name).toBe("worktree-parallel-pr-workflow");
    expect(result.parsed?.description).toContain("independent PRs");
  });

  it("leaves a document that already has a closing fence unchanged", () => {
    const ok =
      "---\nname: x\ndescription: a long enough description here for the validator.\n---\n\n# Body\ntext\n";
    expect(ensureClosingFence(ok)).toBe(ok);
  });

  it("leaves text without an opening fence unchanged", () => {
    const noFm = "# Just a heading\n\nbody\n";
    expect(ensureClosingFence(noFm)).toBe(noFm);
  });

  it("is a no-op when the body heading cannot be located", () => {
    const weird = "---\nname: x\ndescription: y\nstill frontmatter-ish\n";
    expect(ensureClosingFence(weird)).toBe(weird);
  });
});
