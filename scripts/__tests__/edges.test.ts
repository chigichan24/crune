import { describe, it, expect } from "vitest";
import type {
  TopicNode,
  TfidfResult,
  SemanticEdgeType,
} from "../knowledge-graph-builder.js";
import {
  findCommonPathPrefix,
  findSharedKeywords,
  classifyEdge,
} from "../knowledge-graph-builder.js";

function makeTopicNode(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: "topic-1",
    label: "test topic",
    keywords: [],
    project: "projectA",
    projects: ["projectA"],
    sessionIds: ["s1"],
    sessionCount: 1,
    totalDurationMinutes: 10,
    totalToolCalls: 5,
    firstSeen: "2025-01-01",
    lastSeen: "2025-01-02",
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: 0,
    representativePrompts: [],
    suggestedPrompt: "",
    toolSignature: [],
    dominantRole: "user-driven",
    ...overrides,
  };
}

function makeTfidf(vocabulary: string[], vectors: Map<string, Float64Array>): TfidfResult {
  const vocabIndex = new Map<string, number>();
  vocabulary.forEach((v, i) => vocabIndex.set(v, i));
  return { vocabulary, vocabIndex, vectors };
}

describe("findCommonPathPrefix", () => {
  it("returns common prefix for paths sharing a directory", () => {
    expect(findCommonPathPrefix(["/src/a/b.ts", "/src/a/c.ts"])).toBe("/src/a");
  });

  it("returns empty string when prefix is too short (<=1 segment)", () => {
    expect(findCommonPathPrefix(["/a/b", "/c/d"])).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(findCommonPathPrefix([])).toBe("");
  });
});

describe("findSharedKeywords", () => {
  it("returns terms with high weight in both centroids", () => {
    const vocabulary = ["react", "typescript", "testing", "css"];
    const centroids = new Map<string, Float64Array>([
      ["t1", new Float64Array([0.5, 0.8, 0.02, 0.001])],
      ["t2", new Float64Array([0.3, 0.6, 0.9, 0.005])],
    ]);
    const tfidf = makeTfidf(vocabulary, new Map());

    const shared = findSharedKeywords("t1", "t2", tfidf, centroids, 3);
    // "react" (0.5 > 0.01 & 0.3 > 0.01) and "typescript" (0.8 > 0.01 & 0.6 > 0.01)
    // "testing" only in t1 is 0.02 and t2 is 0.9, both > 0.01 → included
    // "css" is below 0.01 in both → excluded
    expect(shared).toContain("react");
    expect(shared).toContain("typescript");
    expect(shared).toContain("testing");
    expect(shared).not.toContain("css");
  });

  it("returns empty array when one centroid is missing", () => {
    const tfidf = makeTfidf(["a"], new Map());
    const centroids = new Map<string, Float64Array>([
      ["t1", new Float64Array([0.5])],
    ]);
    expect(findSharedKeywords("t1", "t_missing", tfidf, centroids, 3)).toEqual([]);
  });
});

describe("classifyEdge", () => {
  it("returns cross-project-bridge when topics are from different projects with no overlap", () => {
    const ti = makeTopicNode({
      id: "t1",
      project: "projectA",
      projects: ["projectA"],
    });
    const tj = makeTopicNode({
      id: "t2",
      project: "projectB",
      projects: ["projectB"],
    });
    const signals = { semanticSimilarity: 0.5, fileOverlap: 0.1, sessionOverlap: 0.1 };
    const tfidf = makeTfidf(["shared"], new Map());
    const centroids = new Map<string, Float64Array>([
      ["t1", new Float64Array([0.5])],
      ["t2", new Float64Array([0.5])],
    ]);

    const result = classifyEdge(ti, tj, signals, [], tfidf, centroids);
    expect(result.type).toBe("cross-project-bridge" as SemanticEdgeType);
    expect(result.label).toContain("cross-project");
  });

  it("returns shared-module when fileOverlap is the dominant signal and shared files exist", () => {
    const ti = makeTopicNode({
      id: "t1",
      project: "projectA",
      projects: ["projectA"],
    });
    const tj = makeTopicNode({
      id: "t2",
      project: "projectA",
      projects: ["projectA"],
    });
    // fileOverlap * 0.3 must be the max signal
    // semanticSimilarity * 0.4 < fileOverlap * 0.3 → need fileOverlap high, semantic low
    const signals = { semanticSimilarity: 0.1, fileOverlap: 0.9, sessionOverlap: 0.0 };
    const sharedFiles = ["/src/components/Button.tsx", "/src/components/Card.tsx"];
    const tfidf = makeTfidf([], new Map());
    const centroids = new Map<string, Float64Array>();

    const result = classifyEdge(ti, tj, signals, sharedFiles, tfidf, centroids);
    expect(result.type).toBe("shared-module" as SemanticEdgeType);
    expect(result.label).toContain("shared");
  });

  it("returns workflow-continuation when sessionOverlap is the dominant signal", () => {
    const ti = makeTopicNode({
      id: "t1",
      project: "projectA",
      projects: ["projectA"],
    });
    const tj = makeTopicNode({
      id: "t2",
      project: "projectA",
      projects: ["projectA"],
    });
    // sessionOverlap * 0.3 must be the max, fileOverlap * 0.3 must be less or no shared files
    const signals = { semanticSimilarity: 0.1, fileOverlap: 0.0, sessionOverlap: 0.9 };
    const tfidf = makeTfidf([], new Map());
    const centroids = new Map<string, Float64Array>();

    const result = classifyEdge(ti, tj, signals, [], tfidf, centroids);
    expect(result.type).toBe("workflow-continuation" as SemanticEdgeType);
    expect(result.label).toBe("workflow continuation");
  });
});
