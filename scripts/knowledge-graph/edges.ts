/**
 * Topic edge construction and classification.
 */

import type { SessionInput, TopicNode, TopicEdge, SemanticEdgeType, TfidfResult, SvdResult } from "./types.js";
import { cosineSimilarity } from "./similarity.js";

export function buildTopicEdges(
  topics: TopicNode[],
  sessions: SessionInput[],
  tfidf: TfidfResult,
  svd?: SvdResult
): TopicEdge[] {
  const edges: TopicEdge[] = [];
  const sessionIndex = new Map<string, SessionInput>();
  for (const s of sessions) sessionIndex.set(s.sessionId, s);

  // Precompute topic centroids in latent SVD space (if available)
  // Falls back to TF-IDF centroids if SVD not provided
  const centroids = new Map<string, Float64Array>();
  for (const topic of topics) {
    if (svd) {
      // Average SVD session vectors for this topic
      const centroid = new Float64Array(svd.k);
      let count = 0;
      for (const sid of topic.sessionIds) {
        const vec = svd.sessionVectors.get(sid);
        if (vec) {
          for (let k = 0; k < svd.k; k++) centroid[k] += vec[k];
          count++;
        }
      }
      if (count > 0) for (let k = 0; k < svd.k; k++) centroid[k] /= count;
      // L2 normalize
      let norm = 0;
      for (let k = 0; k < svd.k; k++) norm += centroid[k] * centroid[k];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let k = 0; k < svd.k; k++) centroid[k] /= norm;
      centroids.set(topic.id, centroid);
    } else {
      // Fallback: TF-IDF centroids
      const centroid = new Float64Array(tfidf.vocabulary.length);
      for (const sid of topic.sessionIds) {
        const vec = tfidf.vectors.get(sid);
        if (vec) {
          for (let k = 0; k < centroid.length; k++) centroid[k] += vec[k];
        }
      }
      for (let k = 0; k < centroid.length; k++) centroid[k] /= topic.sessionIds.length;
      let norm = 0;
      for (let k = 0; k < centroid.length; k++) norm += centroid[k] * centroid[k];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let k = 0; k < centroid.length; k++) centroid[k] /= norm;
      centroids.set(topic.id, centroid);
    }
  }

  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const ti = topics[i];
      const tj = topics[j];

      // Signal 1: Latent semantic similarity (SVD or TF-IDF centroid cosine)
      const ci = centroids.get(ti.id)!;
      const cj = centroids.get(tj.id)!;
      const semanticSim = cosineSimilarity(ci, cj);

      // Signal 2: File overlap (Jaccard of all edited files)
      const filesI = new Set<string>();
      const filesJ = new Set<string>();
      for (const sid of ti.sessionIds) {
        const s = sessionIndex.get(sid);
        if (s) s.meta.filesEdited.forEach((f) => filesI.add(f));
      }
      for (const sid of tj.sessionIds) {
        const s = sessionIndex.get(sid);
        if (s) s.meta.filesEdited.forEach((f) => filesJ.add(f));
      }
      const intersection = [...filesI].filter((f) => filesJ.has(f));
      const union = new Set([...filesI, ...filesJ]);
      const fileOverlap = union.size > 0 ? intersection.length / union.size : 0;

      // Signal 3: Session overlap (temporal adjacency / same branch)
      let sessionOverlap = 0;
      for (const sidI of ti.sessionIds) {
        const si = sessionIndex.get(sidI);
        if (!si) continue;
        for (const sidJ of tj.sessionIds) {
          const sj = sessionIndex.get(sidJ);
          if (!sj) continue;
          if (
            si.projectDisplayName === sj.projectDisplayName &&
            si.meta.gitBranch &&
            si.meta.gitBranch === sj.meta.gitBranch
          ) {
            sessionOverlap = Math.max(sessionOverlap, 0.6);
          }
          // Temporal adjacency: sessions within 1 hour of each other
          const timeDiff = Math.abs(
            new Date(si.meta.createdAt).getTime() -
              new Date(sj.meta.createdAt).getTime()
          );
          if (timeDiff < 3600000) {
            sessionOverlap = Math.max(sessionOverlap, 0.4);
          }
        }
      }

      // Weighted sum
      const strength =
        semanticSim * 0.4 + fileOverlap * 0.3 + sessionOverlap * 0.3;

      if (strength < 0.2) continue;

      // Determine dominant signal and generate label
      const signals = { semanticSimilarity: semanticSim, fileOverlap, sessionOverlap };
      const { type, label } = classifyEdge(ti, tj, signals, intersection, tfidf, centroids);

      edges.push({
        source: ti.id,
        target: tj.id,
        type,
        strength: Math.round(strength * 100) / 100,
        label,
        signals,
      });
    }
  }

  return edges;
}

export function classifyEdge(
  ti: TopicNode,
  tj: TopicNode,
  signals: { semanticSimilarity: number; fileOverlap: number; sessionOverlap: number },
  sharedFiles: string[],
  tfidf: TfidfResult,
  centroids: Map<string, Float64Array>
): { type: SemanticEdgeType; label: string } {
  const isCrossProject =
    ti.projects.some((p) => tj.projects.includes(p)) === false &&
    ti.project !== tj.project;

  if (isCrossProject) {
    // Find shared keywords between centroids
    const sharedKw = findSharedKeywords(ti.id, tj.id, tfidf, centroids, 3);
    return {
      type: "cross-project-bridge",
      label: `cross-project: ${sharedKw.join(", ") || "related concepts"}`,
    };
  }

  // Find dominant signal
  const { semanticSimilarity, fileOverlap, sessionOverlap } = signals;
  const maxSignal = Math.max(semanticSimilarity * 0.4, fileOverlap * 0.3, sessionOverlap * 0.3);

  if (maxSignal === fileOverlap * 0.3 && sharedFiles.length > 0) {
    const commonPrefix = findCommonPathPrefix(sharedFiles);
    return {
      type: "shared-module",
      label: `shared: ${commonPrefix || sharedFiles[0]?.split("/").slice(-2).join("/") || "files"}`,
    };
  }

  if (maxSignal === sessionOverlap * 0.3) {
    return {
      type: "workflow-continuation",
      label: "workflow continuation",
    };
  }

  // Default: semantic similarity
  const sharedKw = findSharedKeywords(ti.id, tj.id, tfidf, centroids, 3);
  return {
    type: "semantic-similarity",
    label: `related: ${sharedKw.join(", ") || "similar topics"}`,
  };
}

export function findSharedKeywords(
  topicIdA: string,
  topicIdB: string,
  tfidf: TfidfResult,
  centroids: Map<string, Float64Array>,
  topK: number
): string[] {
  const ca = centroids.get(topicIdA);
  const cb = centroids.get(topicIdB);
  if (!ca || !cb) return [];

  // Find terms with high weight in both centroids
  const shared: { term: string; score: number }[] = [];
  for (let i = 0; i < tfidf.vocabulary.length; i++) {
    if (ca[i] > 0.01 && cb[i] > 0.01) {
      shared.push({ term: tfidf.vocabulary[i], score: ca[i] * cb[i] });
    }
  }
  shared.sort((a, b) => b.score - a.score);
  return shared.slice(0, topK).map((s) => s.term);
}

export function findCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const segments = paths.map((p) => p.split("/"));
  const minLen = Math.min(...segments.map((s) => s.length));
  let prefixLen = 0;
  for (let i = 0; i < minLen; i++) {
    if (segments.every((s) => s[i] === segments[0][i])) {
      prefixLen = i + 1;
    } else {
      break;
    }
  }
  if (prefixLen <= 1) return ""; // too generic
  return segments[0].slice(0, prefixLen).join("/");
}
