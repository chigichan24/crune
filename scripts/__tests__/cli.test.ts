import { describe, it, expect } from "vitest";
import {
  parseCliArgs,
  renderCandidateDetail,
  serializeCandidate,
  SCHEMA_VERSION,
} from "../cli.js";
import type { TopicNode, SkillCandidate } from "../knowledge-graph/types.js";

function makeCandidate(overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    topicId: "topic-001",
    reusabilityScore: 0.75,
    skillMarkdown: "# skill",
    ...overrides,
  };
}

function makeTopic(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: "topic-001",
    label: "my label",
    keywords: ["alpha", "beta"],
    project: "proj",
    projects: ["proj"],
    sessionIds: ["s1", "s2", "s3"],
    sessionCount: 3,
    totalDurationMinutes: 60,
    totalToolCalls: 10,
    firstSeen: "2026-01-01T00:00:00Z",
    lastSeen: "2026-03-01T00:00:00Z",
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: 0,
    representativePrompts: [],
    suggestedPrompt: "",
    toolSignature: [],
    dominantRole: "user-driven",
    reusabilityScore: {
      overall: 0.75,
      frequency: 1,
      timeCost: 1,
      crossProjectScore: 0,
      recency: 1,
      weightProfile: "base",
      breakdown: [
        { signal: "frequency", value: 1, weight: 0.35, contribution: 0.35 },
        { signal: "timeCost", value: 1, weight: 0.25, contribution: 0.25 },
        { signal: "crossProjectScore", value: 0, weight: 0.25, contribution: 0 },
        { signal: "recency", value: 1, weight: 0.15, contribution: 0.15 },
      ],
    },
    ...overrides,
  } as TopicNode;
}

describe("parseCliArgs", () => {
  it("returns defaults when no args given", () => {
    const result = parseCliArgs(["node", "cli.ts"]);
    expect(result.sessionsDir).toMatch(/\.claude\/projects$/);
    expect(result.outputDir).toMatch(/skills$/);
    expect(result.count).toBe(5);
    expect(result.model).toBeUndefined();
    expect(result.skipSynthesis).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.skipEval).toBe(false);
    expect(result.evalModel).toBeUndefined();
    expect(result.preview).toBe(false);
    expect(result.json).toBe(false);
  });

  it("sets preview with --preview", () => {
    const result = parseCliArgs(["node", "cli.ts", "--preview"]);
    expect(result.preview).toBe(true);
  });

  it("handles --preview combined with --dry-run", () => {
    const result = parseCliArgs(["node", "cli.ts", "--dry-run", "--preview"]);
    expect(result.dryRun).toBe(true);
    expect(result.preview).toBe(true);
  });

  it("sets sessionsDir with --sessions-dir", () => {
    const result = parseCliArgs(["node", "cli.ts", "--sessions-dir", "/tmp/sessions"]);
    expect(result.sessionsDir).toBe("/tmp/sessions");
  });

  it("sets outputDir with --output-dir", () => {
    const result = parseCliArgs(["node", "cli.ts", "--output-dir", "/tmp/out"]);
    expect(result.outputDir).toBe("/tmp/out");
  });

  it("sets count with --count", () => {
    const result = parseCliArgs(["node", "cli.ts", "--count", "3"]);
    expect(result.count).toBe(3);
  });

  it("clamps count to minimum of 1", () => {
    const result = parseCliArgs(["node", "cli.ts", "--count", "0"]);
    expect(result.count).toBe(1);
  });

  it("sets model with --model", () => {
    const result = parseCliArgs(["node", "cli.ts", "--model", "haiku"]);
    expect(result.model).toBe("haiku");
  });

  it("sets skipSynthesis with --skip-synthesis", () => {
    const result = parseCliArgs(["node", "cli.ts", "--skip-synthesis"]);
    expect(result.skipSynthesis).toBe(true);
  });

  it("sets dryRun with --dry-run", () => {
    const result = parseCliArgs(["node", "cli.ts", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("sets skipEval with --skip-eval", () => {
    const result = parseCliArgs(["node", "cli.ts", "--skip-eval"]);
    expect(result.skipEval).toBe(true);
  });

  it("sets evalModel with --eval-model", () => {
    const result = parseCliArgs(["node", "cli.ts", "--eval-model", "haiku"]);
    expect(result.evalModel).toBe("haiku");
  });

  it("handles multiple flags combined", () => {
    const result = parseCliArgs([
      "node",
      "cli.ts",
      "--sessions-dir",
      "/tmp/sessions",
      "--output-dir",
      "/tmp/out",
      "--count",
      "10",
      "--model",
      "sonnet",
      "--skip-synthesis",
      "--dry-run",
    ]);
    expect(result.sessionsDir).toBe("/tmp/sessions");
    expect(result.outputDir).toBe("/tmp/out");
    expect(result.count).toBe(10);
    expect(result.model).toBe("sonnet");
    expect(result.skipSynthesis).toBe(true);
    expect(result.dryRun).toBe(true);
  });
});

describe("renderCandidateDetail", () => {
  it("renders header, keywords, sessions, and breakdown block (with-facets/base)", () => {
    const lines = renderCandidateDetail(makeCandidate(), makeTopic());
    expect(lines[0]).toBe("  [0.75] my label");
    expect(lines).toContain("    Keywords: alpha, beta");
    expect(lines).toContain("    Sessions: 3");
    // breakdown block with weightProfile
    expect(lines.some((l) => l.includes("Breakdown (base)"))).toBe(true);
    expect(
      lines.some((l) => l.trim() === "frequency: 1 x 0.35 = 0.35")
    ).toBe(true);
    expect(
      lines.some((l) => l.trim() === "recency: 1 x 0.15 = 0.15")
    ).toBe(true);
  });

  it("renders facets weightProfile and successRate/helpfulness rows", () => {
    const topic = makeTopic({
      reusabilityScore: {
        overall: 0.8,
        frequency: 1,
        timeCost: 1,
        crossProjectScore: 0,
        recency: 1,
        successRate: 1,
        helpfulness: 1,
        weightProfile: "facets",
        breakdown: [
          { signal: "frequency", value: 1, weight: 0.3, contribution: 0.3 },
          { signal: "successRate", value: 1, weight: 0.1, contribution: 0.1 },
          { signal: "helpfulness", value: 1, weight: 0.1, contribution: 0.1 },
        ],
      },
    });
    const lines = renderCandidateDetail(makeCandidate({ reusabilityScore: 0.8 }), topic);
    expect(lines[0]).toBe("  [0.8] my label");
    expect(lines.some((l) => l.includes("Breakdown (facets)"))).toBe(true);
    expect(
      lines.some((l) => l.trim() === "successRate: 1 x 0.1 = 0.1")
    ).toBe(true);
  });

  it("falls back to topicId and placeholders when topic is missing", () => {
    const lines = renderCandidateDetail(makeCandidate(), undefined);
    expect(lines[0]).toBe("  [0.75] topic-001");
    expect(lines).toContain("    Keywords: —");
    expect(lines).toContain("    Sessions: ?");
    // no breakdown block when topic is missing
    expect(lines.some((l) => l.includes("Breakdown"))).toBe(false);
  });

  it("does not contain console output side effects (returns array)", () => {
    expect(Array.isArray(renderCandidateDetail(makeCandidate(), makeTopic()))).toBe(true);
  });
});

describe("--json flag", () => {
  it("defaults json to false", () => {
    expect(parseCliArgs(["node", "cli.ts"]).json).toBe(false);
  });

  it("sets json with --json", () => {
    expect(parseCliArgs(["node", "cli.ts", "--json"]).json).toBe(true);
  });
});

describe("SCHEMA_VERSION", () => {
  it("is the exported version constant 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe("serializeCandidate", () => {
  it("serializes core fields and breakdown from the topic", () => {
    const obj = serializeCandidate(makeCandidate(), makeTopic());
    expect(obj.topicId).toBe("topic-001");
    expect(obj.label).toBe("my label");
    expect(obj.keywords).toEqual(["alpha", "beta"]);
    expect(obj.sessionCount).toBe(3);
    expect(obj.reusabilityScore).toBe(0.75);
    expect(obj.reusabilityScoreBreakdown).toEqual([
      { signal: "frequency", value: 1, weight: 0.35, contribution: 0.35 },
      { signal: "timeCost", value: 1, weight: 0.25, contribution: 0.25 },
      { signal: "crossProjectScore", value: 0, weight: 0.25, contribution: 0 },
      { signal: "recency", value: 1, weight: 0.15, contribution: 0.15 },
    ]);
  });

  it("omits synthesizedMarkdown when absent", () => {
    const obj = serializeCandidate(makeCandidate(), makeTopic());
    expect("synthesizedMarkdown" in obj).toBe(false);
  });

  it("includes synthesizedMarkdown when present", () => {
    const obj = serializeCandidate(
      makeCandidate({ synthesizedMarkdown: "# synthesized" }),
      makeTopic()
    );
    expect(obj.synthesizedMarkdown).toBe("# synthesized");
  });

  it("falls back to topicId/placeholders when topic missing", () => {
    const obj = serializeCandidate(makeCandidate(), undefined);
    expect(obj.label).toBe("topic-001");
    expect(obj.keywords).toEqual([]);
    expect(obj.sessionCount).toBe(0);
    expect(obj.reusabilityScoreBreakdown).toBeUndefined();
  });
});
