import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  cosineDistance,
  agglomerativeClusteringFromDistMatrix,
  findElbowThreshold,
  clusterWithThresholdFromDistMatrix,
  splitOversizedClusters,
} from "../knowledge-graph-builder.js";

// Helper: create an L2-normalized Float64Array from raw values
function normalized(...values: number[]): Float64Array {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return new Float64Array(values.map((v) => v / norm));
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

// ─── cosineSimilarity ───────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns ~1.0 for identical normalized vectors", () => {
    const v = normalized(1, 2, 3);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it("returns ~0.0 for orthogonal normalized vectors", () => {
    const a = normalized(1, 0, 0);
    const b = normalized(0, 1, 0);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });
});

// ─── cosineDistance ──────────────────────────────────────────────────────────

describe("cosineDistance", () => {
  it("equals 1 - cosineSimilarity", () => {
    const a = normalized(1, 2, 3);
    const b = normalized(3, 2, 1);
    const sim = cosineSimilarity(a, b);
    const dist = cosineDistance(a, b);
    expect(dist).toBeCloseTo(1 - sim, 10);
  });

  it("returns ~0.0 for identical vectors", () => {
    const v = normalized(4, 5, 6);
    expect(cosineDistance(v, v)).toBeCloseTo(0.0, 10);
  });

  it("returns ~1.0 for orthogonal vectors", () => {
    const a = normalized(1, 0);
    const b = normalized(0, 1);
    expect(cosineDistance(a, b)).toBeCloseTo(1.0, 10);
  });
});

// ─── agglomerativeClusteringFromDistMatrix ──────────────────────────────────

describe("agglomerativeClusteringFromDistMatrix", () => {
  it("returns [] for 0 sessions", () => {
    const result = agglomerativeClusteringFromDistMatrix(
      [],
      new Map<string, number>()
    );
    expect(result).toEqual([]);
  });

  it("returns [[0]] for 1 session", () => {
    const result = agglomerativeClusteringFromDistMatrix(
      ["s0"],
      new Map<string, number>()
    );
    expect(result).toEqual([[0]]);
  });

  it("groups 2 close sessions apart from 1 distant session", () => {
    // Sessions 0 and 1 are very close (dist 0.05), session 2 is far from both
    const dist = buildDistMap([
      [0, 1, 0.05],
      [0, 2, 0.95],
      [1, 2, 0.95],
    ]);
    const clusters = agglomerativeClusteringFromDistMatrix(
      ["s0", "s1", "s2"],
      dist
    );

    // Should produce 2 clusters: one with {0,1} and one with {2}
    expect(clusters.length).toBe(2);

    const sorted = clusters
      .map((c) => [...c].sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);

    expect(sorted).toEqual([[0, 1], [2]]);
  });
});

// ─── findElbowThreshold ─────────────────────────────────────────────────────

describe("findElbowThreshold", () => {
  it("returns 0.7 for fewer than 3 distances", () => {
    expect(findElbowThreshold([])).toBe(0.7);
    expect(findElbowThreshold([0.5])).toBe(0.7);
    expect(findElbowThreshold([0.3, 0.6])).toBe(0.7);
  });

  it("detects a jump and returns a value in [0.3, 0.9]", () => {
    const distances = [0.1, 0.2, 0.8, 0.9];
    const threshold = findElbowThreshold(distances);
    expect(threshold).toBeGreaterThanOrEqual(0.3);
    expect(threshold).toBeLessThanOrEqual(0.9);
  });

  it("clamps to 0.3 when all distances are very small", () => {
    const distances = [0.01, 0.02, 0.03, 0.04, 0.05];
    const threshold = findElbowThreshold(distances);
    expect(threshold).toBe(0.3);
  });

  it("clamps to 0.9 when all distances are very large", () => {
    const distances = [0.91, 0.95, 0.99, 1.0, 1.2];
    const threshold = findElbowThreshold(distances);
    expect(threshold).toBe(0.9);
  });
});

// ─── clusterWithThresholdFromDistMatrix ─────────────────────────────────────

describe("clusterWithThresholdFromDistMatrix", () => {
  it("returns [] for n=0", () => {
    expect(
      clusterWithThresholdFromDistMatrix(0, new Map(), 0.5)
    ).toEqual([]);
  });

  it("returns [[0]] for n=1", () => {
    expect(
      clusterWithThresholdFromDistMatrix(1, new Map(), 0.5)
    ).toEqual([[0]]);
  });

  it("merges pairs below threshold", () => {
    // 0-1 close, 2 far
    const dist = buildDistMap([
      [0, 1, 0.1],
      [0, 2, 0.8],
      [1, 2, 0.8],
    ]);
    const clusters = clusterWithThresholdFromDistMatrix(3, dist, 0.5);
    expect(clusters.length).toBe(2);

    const flat = clusters.map((c) => [...c].sort()).sort((a, b) => a[0] - b[0]);
    expect(flat).toEqual([[0, 1], [2]]);
  });

  it("keeps all singletons when threshold is very low", () => {
    const dist = buildDistMap([
      [0, 1, 0.5],
      [0, 2, 0.6],
      [1, 2, 0.7],
    ]);
    const clusters = clusterWithThresholdFromDistMatrix(3, dist, 0.01);
    expect(clusters.length).toBe(3);
  });

  it("merges everything when threshold is very high", () => {
    const dist = buildDistMap([
      [0, 1, 0.3],
      [0, 2, 0.4],
      [1, 2, 0.5],
    ]);
    const clusters = clusterWithThresholdFromDistMatrix(3, dist, 2.0);
    expect(clusters.length).toBe(1);
    expect([...clusters[0]].sort()).toEqual([0, 1, 2]);
  });
});

// ─── splitOversizedClusters ─────────────────────────────────────────────────

describe("splitOversizedClusters", () => {
  it("passes through clusters that are under maxSize", () => {
    const clusters = [[0, 1], [2, 3]];
    const dist = buildDistMap([
      [0, 1, 0.2],
      [2, 3, 0.3],
      [0, 2, 0.8],
      [0, 3, 0.8],
      [1, 2, 0.8],
      [1, 3, 0.8],
    ]);
    const result = splitOversizedClusters(clusters, 100, dist);
    // maxSize = max(10, floor(100 * 0.25)) = 25, both clusters are size 2
    expect(result).toEqual([[0, 1], [2, 3]]);
  });

  it("splits an oversized cluster", () => {
    // Create a cluster of 12 members with totalSessions=20, ratio=0.25
    // maxSize = max(10, floor(20 * 0.25)) = 10, so cluster of 12 is oversized
    const bigCluster = Array.from({ length: 12 }, (_, i) => i);
    const smallCluster = [12, 13];

    // Build distances: two groups within the big cluster
    // Group A (0-5): close to each other, far from group B
    // Group B (6-11): close to each other, far from group A
    const dist = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      for (let j = i + 1; j < 14; j++) {
        const groupI = i < 6 ? "A" : i < 12 ? "B" : "S";
        const groupJ = j < 6 ? "A" : j < 12 ? "B" : "S";
        let d: number;
        if (groupI === groupJ) {
          d = 0.1; // same group: close
        } else {
          d = 0.9; // different group: far
        }
        dist.set(`${i}:${j}`, d);
      }
    }

    const result = splitOversizedClusters(
      [bigCluster, smallCluster],
      20,
      dist
    );

    // The small cluster should pass through
    // The big cluster should be split into at least 2 sub-clusters
    expect(result.length).toBeGreaterThanOrEqual(3); // at least 2 from split + 1 small

    // All original indices should be present
    const allIndices = result.flat().sort((a, b) => a - b);
    expect(allIndices).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it("respects custom maxClusterRatio", () => {
    // 5 members, totalSessions=10, ratio=0.3 -> maxSize = max(10, floor(10*0.3)) = 10
    // So cluster of 5 is fine with ratio 0.3
    const clusters = [[0, 1, 2, 3, 4]];
    const dist = new Map<string, number>();
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        dist.set(`${i}:${j}`, 0.2);
      }
    }
    const result = splitOversizedClusters(clusters, 10, dist, 0.3);
    // maxSize = max(10, 3) = 10, cluster size 5 <= 10, so no split
    expect(result).toEqual([[0, 1, 2, 3, 4]]);
  });
});
