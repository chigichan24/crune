import { describe, it, expect } from "vitest";
import {
  computeSessionHumanSignal,
  aggregateHumanSignal,
  computeReusabilityScores,
  HUMAN_SIGNAL_WEIGHT,
} from "../knowledge-graph/reusability.js";
import type { TopicNode } from "../knowledge-graph/types.js";

describe("computeSessionHumanSignal", () => {
  it("returns the neutral baseline 0.5 with no feedback", () => {
    expect(computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 0 })).toBe(0.5);
  });

  it("a bookmark boosts above the baseline", () => {
    const signal = computeSessionHumanSignal({ bookmarked: true, reusableCount: 0, antiPatternCount: 0 });
    expect(signal).toBeGreaterThan(0.5);
  });

  it("is monotonic non-decreasing in reusableCount", () => {
    const s0 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 0 });
    const s1 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 1, antiPatternCount: 0 });
    const s2 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 2, antiPatternCount: 0 });
    expect(s1).toBeGreaterThan(s0);
    expect(s2).toBeGreaterThanOrEqual(s1);
  });

  it("is monotonic non-increasing in antiPatternCount", () => {
    const s0 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 0 });
    const s1 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 1 });
    const s2 = computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 2 });
    expect(s1).toBeLessThan(s0);
    expect(s2).toBeLessThanOrEqual(s1);
  });

  it("clamps to [0,1]", () => {
    const hi = computeSessionHumanSignal({ bookmarked: true, reusableCount: 99, antiPatternCount: 0 });
    const lo = computeSessionHumanSignal({ bookmarked: false, reusableCount: 0, antiPatternCount: 99 });
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
});

describe("aggregateHumanSignal", () => {
  it("returns 0.5 for an empty topic", () => {
    expect(aggregateHumanSignal([], new Map())).toBe(0.5);
  });

  it("averages per-session signals, treating unknown sessions as neutral", () => {
    const map = new Map([["s1", 1.0]]);
    // s1 (1.0) + s2 (neutral 0.5) -> 0.75
    expect(aggregateHumanSignal(["s1", "s2"], map)).toBeCloseTo(0.75, 5);
  });
});

function makeTopic(id: string, sessionIds: string[]): TopicNode {
  return {
    id,
    label: id,
    keywords: [],
    project: "p",
    projects: ["p"],
    sessionIds,
    sessionCount: sessionIds.length,
    totalDurationMinutes: 60,
    totalToolCalls: 10,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: 0,
    representativePrompts: [],
    suggestedPrompt: "",
    toolSignature: [],
    dominantRole: "user-driven",
    reusabilityScore: {
      overall: 0,
      frequency: 0,
      timeCost: 0,
      crossProjectScore: 0,
      recency: 0,
    },
  };
}

describe("computeReusabilityScores humanSignal term", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");

  it("does not add a humanSignal when no signal map is supplied", () => {
    const topics = [makeTopic("a", ["s1"])];
    computeReusabilityScores(topics, NOW);
    expect(topics[0].reusabilityScore.humanSignal).toBeUndefined();
    expect(topics[0].reusabilityScore.breakdown?.some((b) => b.signal === "humanSignal")).toBe(false);
  });

  it("folds in a humanSignal term with weight HUMAN_SIGNAL_WEIGHT", () => {
    const topics = [makeTopic("a", ["s1"])];
    computeReusabilityScores(topics, NOW, undefined, new Map([["s1", 1.0]]));
    const score = topics[0].reusabilityScore;
    expect(score.humanSignal).toBe(1);
    const term = score.breakdown?.find((b) => b.signal === "humanSignal");
    expect(term?.weight).toBeCloseTo(HUMAN_SIGNAL_WEIGHT, 5);
  });

  it("keeps the breakdown weights summing to ~1.0 after scaling", () => {
    const topics = [makeTopic("a", ["s1"])];
    computeReusabilityScores(topics, NOW, undefined, new Map([["s1", 0.8]]));
    const total = (topics[0].reusabilityScore.breakdown ?? []).reduce((acc, b) => acc + b.weight, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("a stronger human signal yields a higher overall score, all else equal", () => {
    // Two identical topics; only their human signal differs.
    const low = [makeTopic("a", ["s1"])];
    const high = [makeTopic("a", ["s1"])];
    computeReusabilityScores(low, NOW, undefined, new Map([["s1", 0.0]]));
    computeReusabilityScores(high, NOW, undefined, new Map([["s1", 1.0]]));
    expect(high[0].reusabilityScore.overall).toBeGreaterThan(low[0].reusabilityScore.overall);
  });
});
