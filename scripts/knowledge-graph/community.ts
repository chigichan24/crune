/**
 * Louvain community detection and Brandes betweenness centrality.
 */

import type { TopicNode, TopicEdge, KnowledgeCommunity } from "./types.js";

export function louvainDetection(
  topics: TopicNode[],
  edges: TopicEdge[]
): { communities: KnowledgeCommunity[]; modularity: number } {
  const n = topics.length;
  if (n === 0) return { communities: [], modularity: 0 };

  const nodeIndex = new Map<string, number>();
  topics.forEach((t, i) => nodeIndex.set(t.id, i));

  // Build adjacency with weights
  const adjWeights: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  let totalWeight = 0;

  for (const e of edges) {
    const i = nodeIndex.get(e.source);
    const j = nodeIndex.get(e.target);
    if (i === undefined || j === undefined) continue;
    adjWeights[i][j] = e.strength;
    adjWeights[j][i] = e.strength;
    totalWeight += e.strength;
  }

  if (totalWeight === 0) {
    // No edges: each node is its own community
    const communities = topics.map((t, i) => ({
      id: i,
      topicIds: [t.id],
      label: t.keywords[0] || t.label,
      dominantProject: t.project,
    }));
    return { communities, modularity: 0 };
  }

  const m2 = totalWeight; // sum of all edge weights (each edge counted once)

  // Node strengths (weighted degree)
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      k[i] += adjWeights[i][j];
    }
  }

  // Community assignments
  const community = new Int32Array(n);
  for (let i = 0; i < n; i++) community[i] = i;

  // Phase 1: Local modularity optimization
  let improved = true;
  const maxIter = 100;
  let iter = 0;

  while (improved && iter < maxIter) {
    improved = false;
    iter++;

    for (let i = 0; i < n; i++) {
      const currentComm = community[i];

      // Compute sum of weights to each neighboring community
      const commWeights = new Map<number, number>();
      for (let j = 0; j < n; j++) {
        if (adjWeights[i][j] > 0 && i !== j) {
          const c = community[j];
          commWeights.set(c, (commWeights.get(c) || 0) + adjWeights[i][j]);
        }
      }

      // Sum of weights in current community
      const ki = k[i];

      // Try moving to each neighboring community
      let bestComm = currentComm;
      let bestDeltaQ = 0;

      // Remove node i from its current community and compute cost
      let sumCurrentComm = 0;
      let kCurrentComm = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i && community[j] === currentComm) {
          sumCurrentComm += adjWeights[i][j];
          kCurrentComm += k[j];
        }
      }

      for (const [targetComm, wToComm] of commWeights) {
        if (targetComm === currentComm) continue;

        // Sum of weights of nodes in target community
        let kTargetComm = 0;
        for (let j = 0; j < n; j++) {
          if (community[j] === targetComm) {
            kTargetComm += k[j];
          }
        }

        // deltaQ = [w_to_target / m - ki * k_target / (2m²)] - [w_to_current / m - ki * k_current / (2m²)]
        const deltaQ =
          (wToComm - sumCurrentComm) / m2 -
          (ki * (kTargetComm - kCurrentComm)) / (2 * m2 * m2);

        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestComm = targetComm;
        }
      }

      if (bestComm !== currentComm) {
        community[i] = bestComm;
        improved = true;
      }
    }
  }

  // Compute modularity Q
  let modularity = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (community[i] === community[j]) {
        modularity += adjWeights[i][j] - (k[i] * k[j]) / (2 * m2);
      }
    }
  }
  modularity /= 2 * m2;

  // Build community objects
  const commGroups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = community[i];
    const group = commGroups.get(c) || [];
    group.push(i);
    commGroups.set(c, group);
  }

  // Renumber communities
  let commIdx = 0;
  const communities: KnowledgeCommunity[] = [];
  for (const [, members] of commGroups) {
    const topicIds = members.map((i) => topics[i].id);

    // Label from most frequent keywords
    const kwCount = new Map<string, number>();
    for (const i of members) {
      for (const kw of topics[i].keywords) {
        kwCount.set(kw, (kwCount.get(kw) || 0) + 1);
      }
    }
    const topKw = [...kwCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([kw]) => kw);

    // Dominant project
    const projCount = new Map<string, number>();
    for (const i of members) {
      projCount.set(
        topics[i].project,
        (projCount.get(topics[i].project) || 0) + 1
      );
    }
    const dominantProject = [...projCount.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] ?? "";

    // Assign community ID to topics
    for (const i of members) {
      topics[i].communityId = commIdx;
    }

    communities.push({
      id: commIdx,
      topicIds,
      label: topKw.join(", ") || `Community ${commIdx}`,
      dominantProject,
    });
    commIdx++;
  }

  return { communities, modularity };
}

export function brandesBetweenness(
  topics: TopicNode[],
  edges: TopicEdge[]
): void {
  const n = topics.length;
  if (n <= 2) return;

  const nodeIndex = new Map<string, number>();
  topics.forEach((t, i) => nodeIndex.set(t.id, i));

  // Build adjacency list
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const i = nodeIndex.get(e.source);
    const j = nodeIndex.get(e.target);
    if (i === undefined || j === undefined) continue;
    adj[i].push(j);
    adj[j].push(i);
  }

  const CB = new Float64Array(n);

  for (let s = 0; s < n; s++) {
    // BFS from s
    const stack: number[] = [];
    const pred: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Float64Array(n);
    sigma[s] = 1;
    const dist = new Int32Array(n).fill(-1);
    dist[s] = 0;
    const queue: number[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }

    // Back-propagation
    const delta = new Float64Array(n);
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) {
        CB[w] += delta[w];
      }
    }
  }

  // Normalize for undirected graph: divide by 2
  const normFactor = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
  for (let i = 0; i < n; i++) {
    CB[i] = (CB[i] / 2) * normFactor;
  }

  // Assign to topic nodes
  for (let i = 0; i < n; i++) {
    topics[i].betweennessCentrality = Math.round(CB[i] * 10000) / 10000;
  }

  // Degree centrality
  for (let i = 0; i < n; i++) {
    const degree = adj[i].length;
    topics[i].degreeCentrality =
      n > 1 ? Math.round((degree / (n - 1)) * 10000) / 10000 : 0;
  }
}
