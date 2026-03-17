/**
 * Agglomerative clustering with average linkage and automatic elbow detection.
 */

import type { FacetsData } from "./types.js";
import { normalizeGoalCategory } from "./facets-reader.js";

export function agglomerativeClusteringFromDistMatrix(
  sessionIds: string[],
  precomputedDist: Map<string, number>
): number[][] {
  const n = sessionIds.length;
  if (n === 0) return [];
  if (n === 1) return [[0]];

  // Initialize: each session is its own cluster
  const clusterMembers: number[][] = [];
  for (let i = 0; i < n; i++) clusterMembers.push([i]);

  // Track active clusters
  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  // Copy precomputed distances (will be updated during merges)
  const distMatrix = new Map<string, number>(precomputedDist);
  const distKey = (i: number, j: number) =>
    i < j ? `${i}:${j}` : `${j}:${i}`;

  // Merge history for elbow detection
  const mergeDistances: number[] = [];

  // Iteratively merge closest pair
  while (active.size > 1) {
    let minDist = Infinity;
    let mergeI = -1;
    let mergeJ = -1;

    for (const i of active) {
      for (const j of active) {
        if (i >= j) continue;
        const d = distMatrix.get(distKey(i, j)) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    if (mergeI === -1) break;
    mergeDistances.push(minDist);

    // Merge j into i (average linkage: weighted average of distances)
    const sizeI = clusterMembers[mergeI].length;
    const sizeJ = clusterMembers[mergeJ].length;
    const newSize = sizeI + sizeJ;

    clusterMembers[mergeI].push(...clusterMembers[mergeJ]);
    active.delete(mergeJ);

    // Update distances using average linkage formula
    for (const k of active) {
      if (k === mergeI) continue;
      const distIK = distMatrix.get(distKey(mergeI, k)) ?? 1.0;
      const distJK = distMatrix.get(distKey(mergeJ, k)) ?? 1.0;
      const newDist = (distIK * sizeI + distJK * sizeJ) / newSize;
      distMatrix.set(distKey(mergeI, k), newDist);
    }
  }

  // Find elbow: cut point where merging starts getting expensive
  const threshold = findElbowThreshold(mergeDistances);

  // Re-run clustering with threshold using precomputed distances
  return clusterWithThresholdFromDistMatrix(n, precomputedDist, threshold);
}

export function findElbowThreshold(distances: number[]): number {
  if (distances.length < 3) return 0.7; // fallback

  // Compute second derivative (acceleration)
  let maxAccel = 0;
  let elbowIdx = Math.floor(distances.length * 0.5); // default: cut at midpoint

  for (let i = 1; i < distances.length - 1; i++) {
    const accel = distances[i + 1] - 2 * distances[i] + distances[i - 1];
    if (accel > maxAccel) {
      maxAccel = accel;
      elbowIdx = i;
    }
  }

  const threshold = distances[elbowIdx];
  // Clamp to reasonable range
  return Math.max(0.3, Math.min(0.9, threshold));
}

export function clusterWithThresholdFromDistMatrix(
  n: number,
  precomputedDist: Map<string, number>,
  threshold: number
): number[][] {
  if (n === 0) return [];
  if (n === 1) return [[0]];

  const clusterMembers: number[][] = [];
  for (let i = 0; i < n; i++) clusterMembers.push([i]);

  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  const distKey = (i: number, j: number) =>
    i < j ? `${i}:${j}` : `${j}:${i}`;
  const distMatrix = new Map<string, number>(precomputedDist);

  while (active.size > 1) {
    let minDist = Infinity;
    let mergeI = -1;
    let mergeJ = -1;

    for (const i of active) {
      for (const j of active) {
        if (i >= j) continue;
        const d = distMatrix.get(distKey(i, j)) ?? Infinity;
        if (d < minDist) {
          minDist = d;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    if (mergeI === -1 || minDist > threshold) break;

    // Average linkage merge
    const sizeI = clusterMembers[mergeI].length;
    const sizeJ = clusterMembers[mergeJ].length;
    const newSize = sizeI + sizeJ;

    clusterMembers[mergeI].push(...clusterMembers[mergeJ]);
    active.delete(mergeJ);

    for (const k of active) {
      if (k === mergeI) continue;
      const distIK = distMatrix.get(distKey(mergeI, k)) ?? 1.0;
      const distJK = distMatrix.get(distKey(mergeJ, k)) ?? 1.0;
      const newDist = (distIK * sizeI + distJK * sizeJ) / newSize;
      distMatrix.set(distKey(mergeI, k), newDist);
    }
  }

  return [...active].map((i) => clusterMembers[i]);
}

/**
 * Split oversized clusters by re-clustering their members with a stricter
 * (halved) threshold. This prevents a single catch-all cluster from
 * dominating the graph when the global elbow threshold is too loose.
 *
 * maxClusterRatio: a cluster with > (totalSessions * ratio) members is re-split.
 * Default 0.25 = 25% of all sessions.
 */
export function splitOversizedClusters(
  clusters: number[][],
  totalSessions: number,
  precomputedDist: Map<string, number>,
  maxClusterRatio: number = 0.25
): number[][] {
  const maxSize = Math.max(10, Math.floor(totalSessions * maxClusterRatio));
  const result: number[][] = [];

  for (const members of clusters) {
    if (members.length <= maxSize) {
      result.push(members);
      continue;
    }

    // Extract sub-distance-matrix for this cluster's members
    const n = members.length;
    const subDist = new Map<string, number>();
    const distKey = (i: number, j: number) => i < j ? `${i}:${j}` : `${j}:${i}`;
    const origDistKey = (i: number, j: number) => i < j ? `${i}:${j}` : `${j}:${i}`;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const origI = members[i];
        const origJ = members[j];
        const d = precomputedDist.get(origDistKey(origI, origJ)) ?? 1.0;
        subDist.set(distKey(i, j), d);
      }
    }

    // Find sub-elbow threshold from this cluster's internal distances
    const internalDists: number[] = [];
    for (const [, d] of subDist) {
      internalDists.push(d);
    }
    internalDists.sort((a, b) => a - b);

    // Use a stricter threshold: median of internal distances
    const medianDist = internalDists[Math.floor(internalDists.length / 2)] ?? 0.5;
    const subThreshold = Math.max(0.15, medianDist * 0.8);

    const subClusters = clusterWithThresholdFromDistMatrix(n, subDist, subThreshold);

    // Map sub-cluster indices back to original indices
    for (const subMembers of subClusters) {
      result.push(subMembers.map((i) => members[i]));
    }
  }

  return result;
}

/**
 * Merge narrow (≤ maxNarrowSize sessions) clusters that share normalized goal
 * categories from facets data. This addresses the "too narrow scope" issue
 * where the clustering algorithm creates single-session topics.
 *
 * Algorithm:
 * 1. Identify narrow clusters (≤ maxNarrowSize members)
 * 2. For each pair of narrow clusters, check if they share normalized goal categories
 * 3. Merge if they share ≥1 category AND average inter-cluster distance < distanceThreshold
 * 4. Stop merging if merged size exceeds maxMergedSize
 */
export function mergeNarrowClusters(
  clusters: number[][],
  sessionIds: string[],
  facetsMap: Map<string, FacetsData>,
  precomputedDist: Map<string, number>,
  maxNarrowSize: number = 2,
  distanceThreshold: number = 0.7,
  maxMergedSize: number = 8
): number[][] {
  // Separate clusters into narrow and large
  const largeClusters: number[][] = [];
  const narrowClusters: number[][] = [];

  for (const cluster of clusters) {
    if (cluster.length > maxNarrowSize) {
      largeClusters.push(cluster);
    } else {
      narrowClusters.push([...cluster]);
    }
  }

  // If no narrow clusters, return as-is
  if (narrowClusters.length === 0) {
    return clusters;
  }

  // For each narrow cluster, collect normalized goal categories
  const clusterCategories: Set<string>[] = narrowClusters.map((cluster) => {
    const cats = new Set<string>();
    for (const idx of cluster) {
      const sid = sessionIds[idx];
      const facets = facetsMap.get(sid);
      if (facets && facets.goalCategories) {
        for (const rawCat of Object.keys(facets.goalCategories)) {
          cats.add(normalizeGoalCategory(rawCat));
        }
      }
    }
    return cats;
  });

  // Helper: compute average inter-cluster distance
  const avgInterClusterDist = (clusterA: number[], clusterB: number[]): number => {
    let sum = 0;
    let count = 0;
    for (const i of clusterA) {
      for (const j of clusterB) {
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const d = precomputedDist.get(`${lo}:${hi}`) ?? 1.0;
        sum += d;
        count++;
      }
    }
    return count > 0 ? sum / count : 1.0;
  };

  // Helper: check if two category sets share at least one category
  const sharesCategory = (a: Set<string>, b: Set<string>): boolean => {
    for (const cat of a) {
      if (b.has(cat)) return true;
    }
    return false;
  };

  // Track which narrow clusters have been consumed
  const consumed = new Set<number>();

  // Greedily merge narrow clusters
  for (let i = 0; i < narrowClusters.length; i++) {
    if (consumed.has(i)) continue;
    // Skip if this cluster has no facets categories
    if (clusterCategories[i].size === 0) continue;

    for (let j = i + 1; j < narrowClusters.length; j++) {
      if (consumed.has(j)) continue;
      // Skip if target cluster has no facets categories
      if (clusterCategories[j].size === 0) continue;

      // Check shared categories
      if (!sharesCategory(clusterCategories[i], clusterCategories[j])) continue;

      // Check merged size
      if (narrowClusters[i].length + narrowClusters[j].length > maxMergedSize) continue;

      // Check distance
      const dist = avgInterClusterDist(narrowClusters[i], narrowClusters[j]);
      if (dist >= distanceThreshold) continue;

      // Merge j into i
      narrowClusters[i].push(...narrowClusters[j]);
      // Merge categories
      for (const cat of clusterCategories[j]) {
        clusterCategories[i].add(cat);
      }
      consumed.add(j);
    }
  }

  // Collect surviving narrow clusters
  const mergedNarrow: number[][] = [];
  for (let i = 0; i < narrowClusters.length; i++) {
    if (!consumed.has(i)) {
      mergedNarrow.push(narrowClusters[i]);
    }
  }

  return [...largeClusters, ...mergedNarrow];
}
