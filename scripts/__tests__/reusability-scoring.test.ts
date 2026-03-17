import { describe, it, expect } from "vitest";
import {
  computeReusabilityScores,
  type TopicNode,
  type FacetsData,
} from "../knowledge-graph-builder.js";

function makeTopic(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: "topic-001",
    label: "test",
    keywords: ["test"],
    project: "proj",
    projects: ["proj"],
    sessionIds: ["s1"],
    sessionCount: 1,
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
    reusabilityScore: { overall: 0, frequency: 0, timeCost: 0, crossProjectScore: 0, recency: 0 },
    ...overrides,
  };
}

function makeFacets(sessionId: string, outcome: string, helpfulness: string): FacetsData {
  return {
    sessionId,
    underlyingGoal: "test",
    goalCategories: {},
    outcome,
    claudeHelpfulness: helpfulness,
    sessionType: "single_task",
    frictionCounts: {},
    frictionDetail: "",
    primarySuccess: "",
    briefSummary: "",
  };
}

// ─── No facetsMap (backward compatible) ─────────────────────────────────────

describe("computeReusabilityScores without facets", () => {
  it("uses original formula weights (0.35/0.25/0.25/0.15)", () => {
    // Single topic: frequency=1, timeCost=1, crossProject=0, recency=1
    const topic = makeTopic({
      sessionCount: 1,
      totalDurationMinutes: 60,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");
    computeReusabilityScores([topic], now);

    // frequency = 1/1 = 1, timeCost = 60/60 = 1, crossProject = 0 (single project), recency = 1 (same day)
    // overall = 0.35*1 + 0.25*1 + 0.25*0 + 0.15*1 = 0.75
    expect(topic.reusabilityScore.overall).toBe(0.75);
    expect(topic.reusabilityScore.frequency).toBe(1);
    expect(topic.reusabilityScore.timeCost).toBe(1);
    expect(topic.reusabilityScore.crossProjectScore).toBe(0);
    expect(topic.reusabilityScore.recency).toBe(1);
  });
});

// ─── Empty facetsMap (backward compatible) ──────────────────────────────────

describe("computeReusabilityScores with empty facetsMap", () => {
  it("behaves same as no facetsMap", () => {
    const topic = makeTopic({
      sessionCount: 1,
      totalDurationMinutes: 60,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");
    computeReusabilityScores([topic], now, new Map());

    expect(topic.reusabilityScore.overall).toBe(0.75);
    expect(topic.reusabilityScore.successRate).toBeUndefined();
    expect(topic.reusabilityScore.helpfulness).toBeUndefined();
  });
});

// ─── FacetsMap with full coverage ───────────────────────────────────────────

describe("computeReusabilityScores with full facets coverage", () => {
  it("uses new weights (0.30/0.20/0.20/0.10/0.10/0.10) with successRate=1 and helpfulness=1", () => {
    const topic = makeTopic({
      sessionIds: ["s1", "s2"],
      sessionCount: 2,
      totalDurationMinutes: 120,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");

    const facetsMap = new Map<string, FacetsData>();
    facetsMap.set("s1", makeFacets("s1", "fully_achieved", "essential"));
    facetsMap.set("s2", makeFacets("s2", "mostly_achieved", "essential"));

    computeReusabilityScores([topic], now, facetsMap);

    // frequency=1, timeCost=1, crossProject=0, recency=1, successRate=1, helpfulness=1
    // overall = 0.30*1 + 0.20*1 + 0.20*0 + 0.10*1 + 0.10*1 + 0.10*1 = 0.80
    expect(topic.reusabilityScore.overall).toBe(0.8);
    expect(topic.reusabilityScore.successRate).toBe(1);
    expect(topic.reusabilityScore.helpfulness).toBe(1);
  });
});

// ─── FacetsMap with partial coverage ────────────────────────────────────────

describe("computeReusabilityScores with partial facets coverage", () => {
  it("defaults missing sessions to 0.5 for successRate and helpfulness", () => {
    const topic = makeTopic({
      sessionIds: ["s1", "s2"],
      sessionCount: 2,
      totalDurationMinutes: 120,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");

    // Only s1 has facets
    const facetsMap = new Map<string, FacetsData>();
    facetsMap.set("s1", makeFacets("s1", "fully_achieved", "essential"));

    computeReusabilityScores([topic], now, facetsMap);

    // successRate = (1.0 + 0.5) / 2 = 0.75
    // helpfulness = (1.0 + 0.5) / 2 = 0.75
    expect(topic.reusabilityScore.successRate).toBe(0.75);
    expect(topic.reusabilityScore.helpfulness).toBe(0.75);
  });
});

// ─── Not achieved + unhelpful lowers score ──────────────────────────────────

describe("computeReusabilityScores with negative facets", () => {
  it("sets successRate=0 and helpfulness=0 for not_achieved + unhelpful", () => {
    const topic = makeTopic({
      sessionIds: ["s1"],
      sessionCount: 1,
      totalDurationMinutes: 60,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");

    const facetsMap = new Map<string, FacetsData>();
    facetsMap.set("s1", makeFacets("s1", "not_achieved", "unhelpful"));

    computeReusabilityScores([topic], now, facetsMap);

    expect(topic.reusabilityScore.successRate).toBe(0);
    expect(topic.reusabilityScore.helpfulness).toBe(0);

    // overall = 0.30*1 + 0.20*1 + 0.20*0 + 0.10*1 + 0.10*0 + 0.10*0 = 0.60
    expect(topic.reusabilityScore.overall).toBe(0.6);
  });
});

// ─── Score fields set on ReusabilityScore ───────────────────────────────────

describe("ReusabilityScore fields with facets", () => {
  it("sets successRate and helpfulness fields when facetsMap is provided", () => {
    const topic = makeTopic({
      sessionIds: ["s1"],
      sessionCount: 1,
      totalDurationMinutes: 60,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");

    const facetsMap = new Map<string, FacetsData>();
    facetsMap.set("s1", makeFacets("s1", "fully_achieved", "very_helpful"));

    computeReusabilityScores([topic], now, facetsMap);

    expect(topic.reusabilityScore.successRate).toBeDefined();
    expect(topic.reusabilityScore.helpfulness).toBeDefined();
    expect(typeof topic.reusabilityScore.successRate).toBe("number");
    expect(typeof topic.reusabilityScore.helpfulness).toBe("number");
  });
});

// ─── Score fields NOT set when no facets ────────────────────────────────────

describe("ReusabilityScore fields without facets", () => {
  it("does not set successRate and helpfulness when no facetsMap", () => {
    const topic = makeTopic({
      sessionCount: 1,
      totalDurationMinutes: 60,
      projects: ["proj"],
      lastSeen: "2026-03-17T00:00:00Z",
    });
    const now = new Date("2026-03-17T00:00:00Z");
    computeReusabilityScores([topic], now);

    expect(topic.reusabilityScore.successRate).toBeUndefined();
    expect(topic.reusabilityScore.helpfulness).toBeUndefined();
  });
});
