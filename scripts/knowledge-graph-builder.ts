/**
 * knowledge-graph-builder.ts
 *
 * Semantic knowledge graph construction from Claude Code session data.
 * Pipeline: TF-IDF → Agglomerative Clustering → Topic Nodes/Edges → Louvain → Brandes
 */

// ─── Input types (subset of analyze-sessions.ts types) ──────────────────────

export interface SessionInput {
  sessionId: string;
  projectDisplayName: string;
  turns: {
    userPrompt: string;
    assistantTexts: string[];
    toolCalls: { toolName: string; input: Record<string, unknown> }[];
  }[];
  meta: {
    sessionId: string;
    createdAt: string;
    lastActiveAt: string;
    durationMinutes: number;
    filesEdited: string[];
    gitBranch: string;
    toolBreakdown: Record<string, number>;
  };
}

// ─── Output types ───────────────────────────────────────────────────────────

export type SemanticEdgeType =
  | "semantic-similarity"
  | "shared-module"
  | "workflow-continuation"
  | "cross-project-bridge";

export interface TopicNode {
  id: string;
  label: string;
  keywords: string[];
  project: string;
  projects: string[];
  sessionIds: string[];
  sessionCount: number;
  totalDurationMinutes: number;
  totalToolCalls: number;
  firstSeen: string;
  lastSeen: string;
  betweennessCentrality: number;
  degreeCentrality: number;
  communityId: number;
}

export interface TopicEdge {
  source: string;
  target: string;
  type: SemanticEdgeType;
  strength: number;
  label: string;
  signals: {
    semanticSimilarity: number;
    fileOverlap: number;
    sessionOverlap: number;
  };
}

export interface KnowledgeCommunity {
  id: number;
  topicIds: string[];
  label: string;
  dominantProject: string;
}

export interface KnowledgeGraphMetrics {
  totalTopics: number;
  totalEdges: number;
  graphDensity: number;
  modularity: number;
  isolatedTopicCount: number;
  bridgeTopicIds: string[];
}

export interface SemanticKnowledgeGraph {
  nodes: TopicNode[];
  edges: TopicEdge[];
  communities: KnowledgeCommunity[];
  metrics: KnowledgeGraphMetrics;
}

// ─── Stop words ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "ought",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "mine",
  "yours", "hers", "ours", "theirs", "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "because", "as", "until", "while", "of", "at", "by",
  "for", "with", "about", "against", "between", "through", "during",
  "before", "after", "above", "below", "to", "from", "up", "down", "in",
  "out", "on", "off", "over", "under", "again", "further", "then", "once",
  "here", "there", "and", "but", "or", "if", "else", "also", "like",
  "please", "thanks", "thank", "yes", "no", "ok", "okay", "sure", "let",
  "make", "use", "using", "used", "want", "see", "look", "try", "get",
  "got", "think", "know", "now", "new", "way", "well", "back", "still",
  "file", "code", "change", "changes", "add", "update", "fix", "set",
  // Japanese particles and common words
  "の", "に", "は", "を", "が", "で", "と", "も", "か", "な", "だ",
  "です", "ます", "する", "した", "して", "ない", "ある", "いる",
  "これ", "それ", "あれ", "この", "その", "あの", "ここ", "そこ",
  "こと", "もの", "ため", "よう", "から", "まで", "より", "ほど",
  "など", "ので", "けど", "でも", "しかし", "また", "そして",
  "って", "という", "ください", "お願い", "確認",
]);

// ─── Tokenizer ──────────────────────────────────────────────────────────────

function splitCamelCase(word: string): string[] {
  return word
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .map((w) => w.toLowerCase());
}

function extractPathTokens(text: string): string[] {
  const pathPattern = /(?:\/[\w.-]+){2,}/g;
  const tokens: string[] = [];
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    const segments = match[0].split("/").filter(Boolean);
    for (const seg of segments) {
      const name = seg.replace(/\.[^.]+$/, ""); // remove extension
      if (name.length > 2) {
        tokens.push(...splitCamelCase(name));
      }
    }
  }
  return tokens;
}

// UUID pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pure hex string (>= 6 chars)
const HEX_PATTERN = /^[0-9a-f]{6,}$/i;
// Pure numbers
const NUM_PATTERN = /^\d+$/;

function isNoiseToken(token: string): boolean {
  return (
    UUID_PATTERN.test(token) ||
    HEX_PATTERN.test(token) ||
    NUM_PATTERN.test(token) ||
    token.length > 40 // extremely long tokens are noise
  );
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // Extract file path tokens first
  tokens.push(...extractPathTokens(text));

  // Split on whitespace, punctuation, CJK boundaries
  const words = text
    .replace(/[`'"{}()\[\]<>;:,!?@#$%^&*=+|\\~]/g, " ")
    .replace(/\//g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    // Skip URLs and UUIDs
    if (word.startsWith("http")) continue;
    if (UUID_PATTERN.test(word)) continue;

    // Handle kebab-case and snake_case
    const parts = word.split(/[-_]/).filter(Boolean);
    for (const part of parts) {
      // Split CamelCase
      const subTokens = splitCamelCase(part);
      for (const t of subTokens) {
        const clean = t.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]/g, "");
        if (
          clean.length > 2 &&
          !STOP_WORDS.has(clean) &&
          !isNoiseToken(clean)
        ) {
          tokens.push(clean);
        }
      }
    }
  }

  return tokens;
}

// ─── TF-IDF ─────────────────────────────────────────────────────────────────

interface TfidfResult {
  vocabulary: string[];
  vocabIndex: Map<string, number>;
  vectors: Map<string, Float64Array>;
}

function buildTfidf(
  documents: Map<string, string[]>
): TfidfResult {
  // Build vocabulary
  const df = new Map<string, number>(); // document frequency
  for (const [, tokens] of documents) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  // Filter vocabulary: appear in at least 2 docs, but not in > 80% of docs
  const n = documents.size;
  const maxDf = Math.max(2, Math.floor(n * 0.8));
  const vocabulary: string[] = [];
  const vocabIndex = new Map<string, number>();

  for (const [term, count] of df) {
    if (count >= 2 && count <= maxDf) {
      vocabIndex.set(term, vocabulary.length);
      vocabulary.push(term);
    }
  }

  // Build TF-IDF vectors
  const vectors = new Map<string, Float64Array>();

  for (const [docId, tokens] of documents) {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      if (vocabIndex.has(t)) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
    }

    const vec = new Float64Array(vocabulary.length);
    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term)!;
      const termFreq = Math.log(1 + count);
      const invDocFreq = Math.log(n / (df.get(term) || 1));
      vec[idx] = termFreq * invDocFreq;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }

    vectors.set(docId, vec);
  }

  return { vocabulary, vocabIndex, vectors };
}

// ─── Cosine similarity / distance ───────────────────────────────────────────

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // Already L2-normalized
}

function cosineDistance(a: Float64Array, b: Float64Array): number {
  return 1 - cosineSimilarity(a, b);
}

// ─── Agglomerative Clustering (Average Linkage) ────────────────────────────

interface Cluster {
  members: number[]; // indices into sessionIds array
  centroid: Float64Array;
}

function agglomerativeClustering(
  sessionIds: string[],
  vectors: Map<string, Float64Array>,
  vocabSize: number
): number[][] {
  const n = sessionIds.length;
  if (n === 0) return [];
  if (n === 1) return [[0]];

  // Initialize: each session is its own cluster
  const clusters: Cluster[] = sessionIds.map((id, _i) => ({
    members: [_i],
    centroid: new Float64Array(vectors.get(id) || new Float64Array(vocabSize)),
  }));

  // Track active clusters
  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  // Precompute distance matrix (upper triangle)
  const distMatrix = new Map<string, number>();
  const distKey = (i: number, j: number) =>
    i < j ? `${i}:${j}` : `${j}:${i}`;

  for (const i of active) {
    for (const j of active) {
      if (i >= j) continue;
      distMatrix.set(distKey(i, j), cosineDistance(clusters[i].centroid, clusters[j].centroid));
    }
  }

  // Merge history for elbow detection
  const mergeDistances: number[] = [];

  // Iteratively merge closest pair
  while (active.size > 1) {
    // Find closest pair
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

    // Merge j into i
    const ci = clusters[mergeI];
    const cj = clusters[mergeJ];
    const newSize = ci.members.length + cj.members.length;

    // Update centroid (weighted average)
    const newCentroid = new Float64Array(vocabSize);
    for (let k = 0; k < vocabSize; k++) {
      newCentroid[k] =
        (ci.centroid[k] * ci.members.length +
          cj.centroid[k] * cj.members.length) /
        newSize;
    }
    // L2 normalize centroid
    let norm = 0;
    for (let k = 0; k < vocabSize; k++) norm += newCentroid[k] * newCentroid[k];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let k = 0; k < vocabSize; k++) newCentroid[k] /= norm;
    }

    ci.members.push(...cj.members);
    ci.centroid = newCentroid;

    // Remove j, update distances for i
    active.delete(mergeJ);
    for (const k of active) {
      if (k === mergeI) continue;
      const newDist = cosineDistance(ci.centroid, clusters[k].centroid);
      distMatrix.set(distKey(mergeI, k), newDist);
    }
  }

  // Find elbow: cut point where merging starts getting expensive
  const threshold = findElbowThreshold(mergeDistances);

  // Re-run clustering with threshold
  return clusterWithThreshold(sessionIds, vectors, vocabSize, threshold);
}

function findElbowThreshold(distances: number[]): number {
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

function clusterWithThreshold(
  sessionIds: string[],
  vectors: Map<string, Float64Array>,
  vocabSize: number,
  threshold: number
): number[][] {
  const n = sessionIds.length;
  if (n === 0) return [];
  if (n === 1) return [[0]];

  const clusters: Cluster[] = sessionIds.map((id) => ({
    members: [sessionIds.indexOf(id)],
    centroid: new Float64Array(vectors.get(id) || new Float64Array(vocabSize)),
  }));

  const active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  const distKey = (i: number, j: number) =>
    i < j ? `${i}:${j}` : `${j}:${i}`;
  const distMatrix = new Map<string, number>();

  for (const i of active) {
    for (const j of active) {
      if (i >= j) continue;
      distMatrix.set(
        distKey(i, j),
        cosineDistance(clusters[i].centroid, clusters[j].centroid)
      );
    }
  }

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

    const ci = clusters[mergeI];
    const cj = clusters[mergeJ];
    const newSize = ci.members.length + cj.members.length;

    const newCentroid = new Float64Array(vocabSize);
    for (let k = 0; k < vocabSize; k++) {
      newCentroid[k] =
        (ci.centroid[k] * ci.members.length +
          cj.centroid[k] * cj.members.length) /
        newSize;
    }
    let norm = 0;
    for (let k = 0; k < vocabSize; k++) norm += newCentroid[k] * newCentroid[k];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let k = 0; k < vocabSize; k++) newCentroid[k] /= norm;
    }

    ci.members.push(...cj.members);
    ci.centroid = newCentroid;
    active.delete(mergeJ);

    for (const k of active) {
      if (k === mergeI) continue;
      distMatrix.set(
        distKey(mergeI, k),
        cosineDistance(ci.centroid, clusters[k].centroid)
      );
    }
  }

  return [...active].map((i) => clusters[i].members);
}

// ─── Topic Node Construction ────────────────────────────────────────────────

function buildTopicNodes(
  clusterMembers: number[][],
  sessions: SessionInput[],
  tfidf: TfidfResult
): TopicNode[] {
  const topics: TopicNode[] = [];

  for (let ci = 0; ci < clusterMembers.length; ci++) {
    const members = clusterMembers[ci];
    const memberSessions = members.map((idx) => sessions[idx]);

    // Compute cluster centroid
    const centroid = new Float64Array(tfidf.vocabulary.length);
    for (const idx of members) {
      const vec = tfidf.vectors.get(sessions[idx].sessionId);
      if (vec) {
        for (let k = 0; k < centroid.length; k++) centroid[k] += vec[k];
      }
    }
    for (let k = 0; k < centroid.length; k++) centroid[k] /= members.length;

    // Top-5 keywords from centroid
    const scored = tfidf.vocabulary.map((term, idx) => ({
      term,
      score: centroid[idx],
    }));
    scored.sort((a, b) => b.score - a.score);
    const keywords = scored.slice(0, 5).map((s) => s.term);

    // Dominant project
    const projectCounts = new Map<string, number>();
    for (const s of memberSessions) {
      projectCounts.set(
        s.projectDisplayName,
        (projectCounts.get(s.projectDisplayName) || 0) + 1
      );
    }
    const sortedProjects = [...projectCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    const dominantProject = sortedProjects[0]?.[0] ?? "";
    const allProjects = [...new Set(memberSessions.map((s) => s.projectDisplayName))];

    // Label: top 2-3 keywords + project
    const labelKeywords = keywords.slice(0, 3).join(", ");
    const projectSuffix = allProjects.length > 1
      ? `(${allProjects.length} projects)`
      : `(${dominantProject.split("/").pop() || dominantProject})`;
    const label = `${labelKeywords} ${projectSuffix}`;

    // Aggregate metadata
    const sessionIds = memberSessions.map((s) => s.sessionId);
    const totalDuration = memberSessions.reduce(
      (sum, s) => sum + s.meta.durationMinutes,
      0
    );
    const totalToolCalls = memberSessions.reduce((sum, s) => {
      return (
        sum +
        Object.values(s.meta.toolBreakdown).reduce((a, b) => a + b, 0)
      );
    }, 0);

    const dates = memberSessions
      .map((s) => s.meta.createdAt)
      .filter(Boolean)
      .sort();

    topics.push({
      id: `topic-${String(ci + 1).padStart(3, "0")}`,
      label,
      keywords,
      project: dominantProject,
      projects: allProjects,
      sessionIds,
      sessionCount: members.length,
      totalDurationMinutes: Math.round(totalDuration),
      totalToolCalls,
      firstSeen: dates[0] || "",
      lastSeen: dates[dates.length - 1] || "",
      betweennessCentrality: 0, // computed later
      degreeCentrality: 0, // computed later
      communityId: -1, // computed later
    });
  }

  return topics;
}

// ─── Topic Edge Construction ────────────────────────────────────────────────

function buildTopicEdges(
  topics: TopicNode[],
  sessions: SessionInput[],
  tfidf: TfidfResult
): TopicEdge[] {
  const edges: TopicEdge[] = [];
  const sessionIndex = new Map<string, SessionInput>();
  for (const s of sessions) sessionIndex.set(s.sessionId, s);

  // Precompute topic centroids
  const centroids = new Map<string, Float64Array>();
  for (const topic of topics) {
    const centroid = new Float64Array(tfidf.vocabulary.length);
    for (const sid of topic.sessionIds) {
      const vec = tfidf.vectors.get(sid);
      if (vec) {
        for (let k = 0; k < centroid.length; k++) centroid[k] += vec[k];
      }
    }
    for (let k = 0; k < centroid.length; k++) centroid[k] /= topic.sessionIds.length;
    // L2 normalize
    let norm = 0;
    for (let k = 0; k < centroid.length; k++) norm += centroid[k] * centroid[k];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let k = 0; k < centroid.length; k++) centroid[k] /= norm;
    }
    centroids.set(topic.id, centroid);
  }

  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const ti = topics[i];
      const tj = topics[j];

      // Signal 1: Semantic similarity (centroid cosine)
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
      // Only count if there's also some semantic or file signal to avoid pure-operational edges
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

function classifyEdge(
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

function findSharedKeywords(
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

function findCommonPathPrefix(paths: string[]): string {
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

// ─── Louvain Community Detection ────────────────────────────────────────────

function louvainDetection(
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

// ─── Brandes Betweenness Centrality ─────────────────────────────────────────

function brandesBetweenness(
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

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function buildSemanticKnowledgeGraph(
  sessions: SessionInput[]
): SemanticKnowledgeGraph {
  console.log(`  [Knowledge Graph] Processing ${sessions.length} sessions...`);

  // Edge case: too few sessions
  if (sessions.length === 0) {
    return {
      nodes: [],
      edges: [],
      communities: [],
      metrics: {
        totalTopics: 0,
        totalEdges: 0,
        graphDensity: 0,
        modularity: 0,
        isolatedTopicCount: 0,
        bridgeTopicIds: [],
      },
    };
  }

  // Step 1: Extract session documents
  const documents = new Map<string, string[]>();
  for (const session of sessions) {
    const textParts: string[] = [];
    for (const turn of session.turns) {
      if (turn.userPrompt) textParts.push(turn.userPrompt);
      for (const text of turn.assistantTexts) {
        textParts.push(text);
      }
    }
    // Also include file paths as tokens
    for (const f of session.meta.filesEdited) {
      textParts.push(f);
    }
    // Include branch name
    if (session.meta.gitBranch) {
      textParts.push(session.meta.gitBranch);
    }

    const fullText = textParts.join(" ");
    const tokens = tokenize(fullText);

    if (tokens.length > 0) {
      documents.set(session.sessionId, tokens);
    }
  }

  console.log(
    `  [Knowledge Graph] Tokenized ${documents.size} sessions (${sessions.length - documents.size} excluded: empty)`
  );

  // Filter sessions to only those with documents
  const activeSessions = sessions.filter((s) => documents.has(s.sessionId));
  const sessionIds = activeSessions.map((s) => s.sessionId);

  if (activeSessions.length < 2) {
    // Single session: create one topic
    const singleTopic = buildTopicNodes(
      [sessionIds.map((_, i) => i)],
      activeSessions,
      { vocabulary: [], vocabIndex: new Map(), vectors: new Map() }
    );
    return {
      nodes: singleTopic,
      edges: [],
      communities: [
        {
          id: 0,
          topicIds: singleTopic.map((t) => t.id),
          label: singleTopic[0]?.label || "All",
          dominantProject: singleTopic[0]?.project || "",
        },
      ],
      metrics: {
        totalTopics: singleTopic.length,
        totalEdges: 0,
        graphDensity: 0,
        modularity: 0,
        isolatedTopicCount: singleTopic.length,
        bridgeTopicIds: [],
      },
    };
  }

  // Step 2-3: TF-IDF
  const tfidf = buildTfidf(documents);
  console.log(
    `  [Knowledge Graph] TF-IDF: ${tfidf.vocabulary.length} terms in vocabulary`
  );

  // Step 4: Clustering
  let clusterMembers: number[][];
  if (activeSessions.length < 5) {
    // Too few: each session is its own topic
    clusterMembers = sessionIds.map((_, i) => [i]);
  } else {
    clusterMembers = agglomerativeClustering(
      sessionIds,
      tfidf.vectors,
      tfidf.vocabulary.length
    );
  }

  console.log(
    `  [Knowledge Graph] Clustering: ${clusterMembers.length} topics from ${activeSessions.length} sessions`
  );

  // Step 5: Build topic nodes
  const topics = buildTopicNodes(clusterMembers, activeSessions, tfidf);

  // Step 6: Build topic edges
  const edges = buildTopicEdges(topics, activeSessions, tfidf);
  console.log(`  [Knowledge Graph] Edges: ${edges.length} topic connections`);

  // Step 7: Louvain community detection
  const { communities, modularity } = louvainDetection(topics, edges);
  console.log(
    `  [Knowledge Graph] Communities: ${communities.length} (modularity: ${modularity.toFixed(3)})`
  );

  // Step 8: Graph metrics (Brandes + degree centrality)
  brandesBetweenness(topics, edges);

  const isolatedCount = topics.filter((t) => t.degreeCentrality === 0).length;
  const nTopics = topics.length;
  const maxEdges = (nTopics * (nTopics - 1)) / 2;
  const density = maxEdges > 0 ? edges.length / maxEdges : 0;

  // Bridge topics: top 10% by betweenness centrality
  const sortedByBetweenness = [...topics]
    .filter((t) => t.betweennessCentrality > 0)
    .sort((a, b) => b.betweennessCentrality - a.betweennessCentrality);
  const bridgeCount = Math.max(1, Math.ceil(sortedByBetweenness.length * 0.1));
  const bridgeTopicIds = sortedByBetweenness
    .slice(0, bridgeCount)
    .map((t) => t.id);

  const metrics: KnowledgeGraphMetrics = {
    totalTopics: nTopics,
    totalEdges: edges.length,
    graphDensity: Math.round(density * 10000) / 10000,
    modularity: Math.round(modularity * 10000) / 10000,
    isolatedTopicCount: isolatedCount,
    bridgeTopicIds,
  };

  console.log(
    `  [Knowledge Graph] Done. ${nTopics} topics, ${edges.length} edges, ${communities.length} communities, ${isolatedCount} isolated`
  );

  return { nodes: topics, edges, communities, metrics };
}
