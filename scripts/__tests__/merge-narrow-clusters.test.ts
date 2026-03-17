import { describe, it, expect } from "vitest";
import { mergeNarrowClusters } from "../knowledge-graph-builder.js";
import type { FacetsData } from "../knowledge-graph-builder.js";

// Helper: build a FacetsData object
function makeFacets(
  sessionId: string,
  goalCategories: Record<string, number>,
  outcome: string = "fully_achieved"
): FacetsData {
  return {
    sessionId,
    underlyingGoal: "test goal",
    goalCategories,
    outcome,
    claudeHelpfulness: "essential",
    sessionType: "single_task",
    frictionCounts: {},
    frictionDetail: "",
    primarySuccess: "multi_file_changes",
    briefSummary: "test summary",
  };
}

// Helper: build a distance map with key format `${min}:${max}`
function buildDistMap(
  entries: [number, number, number][]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const [i, j, d] of entries) {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    m.set(`${lo}:${hi}`, d);
  }
  return m;
}

// ─── mergeNarrowClusters ────────────────────────────────────────────────────

describe("mergeNarrowClusters", () => {
  it("returns unchanged when no narrow clusters exist", () => {
    // All clusters have > maxNarrowSize (2) members
    const clusters = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    const sessionIds = ["s0", "s1", "s2", "s3", "s4", "s5"];
    const facetsMap = new Map<string, FacetsData>();
    const dist = buildDistMap([
      [0, 1, 0.1], [0, 2, 0.1], [1, 2, 0.1],
      [3, 4, 0.1], [3, 5, 0.1], [4, 5, 0.1],
      [0, 3, 0.9], [0, 4, 0.9], [0, 5, 0.9],
      [1, 3, 0.9], [1, 4, 0.9], [1, 5, 0.9],
      [2, 3, 0.9], [2, 4, 0.9], [2, 5, 0.9],
    ]);

    const result = mergeNarrowClusters(clusters, sessionIds, facetsMap, dist);
    expect(result).toEqual(clusters);
  });

  it("returns unchanged when narrow clusters have no facets data", () => {
    const clusters = [[0], [1]];
    const sessionIds = ["s0", "s1"];
    const facetsMap = new Map<string, FacetsData>(); // empty
    const dist = buildDistMap([[0, 1, 0.3]]);

    const result = mergeNarrowClusters(clusters, sessionIds, facetsMap, dist);
    // Both clusters survive unmerged (no facets to match on)
    expect(result.length).toBe(2);
  });

  it("merges two narrow clusters with shared goal categories and close distance", () => {
    const clusters = [[0], [1]];
    const sessionIds = ["s0", "s1"];
    const facetsMap = new Map<string, FacetsData>([
      ["s0", makeFacets("s0", { feature_add_button: 1 })],
      ["s1", makeFacets("s1", { feature_update_header: 1 })],
    ]);
    // Both normalize to "feature"
    const dist = buildDistMap([[0, 1, 0.3]]);

    const result = mergeNarrowClusters(clusters, sessionIds, facetsMap, dist);
    expect(result.length).toBe(1);
    expect([...result[0]].sort()).toEqual([0, 1]);
  });

  it("does not merge when goal categories differ", () => {
    const clusters = [[0], [1]];
    const sessionIds = ["s0", "s1"];
    const facetsMap = new Map<string, FacetsData>([
      ["s0", makeFacets("s0", { feature_add_button: 1 })],
      ["s1", makeFacets("s1", { fix_bug_crash: 1 })],
    ]);
    // "feature" vs "bugfix" - no overlap
    const dist = buildDistMap([[0, 1, 0.3]]);

    const result = mergeNarrowClusters(clusters, sessionIds, facetsMap, dist);
    expect(result.length).toBe(2);
  });

  it("does not merge when distance exceeds threshold", () => {
    const clusters = [[0], [1]];
    const sessionIds = ["s0", "s1"];
    const facetsMap = new Map<string, FacetsData>([
      ["s0", makeFacets("s0", { feature_add_button: 1 })],
      ["s1", makeFacets("s1", { feature_update_header: 1 })],
    ]);
    // Shared category "feature" but distance too far
    const dist = buildDistMap([[0, 1, 0.9]]);

    const result = mergeNarrowClusters(
      clusters, sessionIds, facetsMap, dist,
      2,    // maxNarrowSize
      0.7,  // distanceThreshold
    );
    expect(result.length).toBe(2);
  });

  it("respects maxMergedSize limit", () => {
    // 3 narrow clusters of size 2 each; maxMergedSize = 3
    const clusters = [[0, 1], [2, 3], [4, 5]];
    const sessionIds = ["s0", "s1", "s2", "s3", "s4", "s5"];
    const facetsMap = new Map<string, FacetsData>([
      ["s0", makeFacets("s0", { feature_x: 1 })],
      ["s1", makeFacets("s1", { feature_y: 1 })],
      ["s2", makeFacets("s2", { feature_z: 1 })],
      ["s3", makeFacets("s3", { feature_w: 1 })],
      ["s4", makeFacets("s4", { feature_v: 1 })],
      ["s5", makeFacets("s5", { feature_u: 1 })],
    ]);
    // All close distances
    const entries: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        entries.push([i, j, 0.2]);
      }
    }
    const dist = buildDistMap(entries);

    // maxMergedSize = 3 means first merge (2+2=4) already exceeds limit
    const result = mergeNarrowClusters(
      clusters, sessionIds, facetsMap, dist,
      2,    // maxNarrowSize
      0.7,  // distanceThreshold
      3,    // maxMergedSize - too small for any pair merge
    );
    // No merges possible since 2+2=4 > 3
    expect(result.length).toBe(3);
  });

  it("handles chain merges: A+B then (A+B)+C", () => {
    // Three singleton narrow clusters, all share "feature" category and are close
    const clusters = [[0], [1], [2]];
    const sessionIds = ["s0", "s1", "s2"];
    const facetsMap = new Map<string, FacetsData>([
      ["s0", makeFacets("s0", { feature_a: 1 })],
      ["s1", makeFacets("s1", { feature_b: 1 })],
      ["s2", makeFacets("s2", { feature_c: 1 })],
    ]);
    const dist = buildDistMap([
      [0, 1, 0.2],
      [0, 2, 0.3],
      [1, 2, 0.25],
    ]);

    const result = mergeNarrowClusters(
      clusters, sessionIds, facetsMap, dist,
      2,    // maxNarrowSize
      0.7,  // distanceThreshold
      8,    // maxMergedSize
    );
    // All three should be merged into one cluster
    expect(result.length).toBe(1);
    expect([...result[0]].sort()).toEqual([0, 1, 2]);
  });

  it("leaves large clusters untouched and only merges narrow ones", () => {
    // One large cluster [0,1,2], two narrow singletons [3], [4]
    const clusters = [[0, 1, 2], [3], [4]];
    const sessionIds = ["s0", "s1", "s2", "s3", "s4"];
    const facetsMap = new Map<string, FacetsData>([
      ["s3", makeFacets("s3", { fix_bug_a: 1 })],
      ["s4", makeFacets("s4", { fix_bug_b: 1 })],
    ]);
    // Narrow clusters are close
    const entries: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        entries.push([i, j, i < 3 && j < 3 ? 0.1 : 0.3]);
      }
    }
    const dist = buildDistMap(entries);

    const result = mergeNarrowClusters(
      clusters, sessionIds, facetsMap, dist,
      2,    // maxNarrowSize
      0.7,  // distanceThreshold
      8,    // maxMergedSize
    );

    // Large cluster stays as-is, two narrow clusters merge into one
    expect(result.length).toBe(2);

    // The large cluster should be present
    const sorted = result
      .map((c) => [...c].sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);
    expect(sorted[0]).toEqual([0, 1, 2]);
    expect(sorted[1]).toEqual([3, 4]);
  });
});
