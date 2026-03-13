/**
 * knowledge-graph-builder.ts
 *
 * Semantic knowledge graph construction from Claude Code session data.
 * Pipeline: TF-IDF + Tool-IDF + Structure → SVD (Latent Semantic) → Clustering → Louvain → Brandes
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
  subagents: Record<string, {
    agentId: string;
    agentType: string;
    turns: {
      userPrompt: string;
      assistantTexts: string[];
      toolCalls: { toolName: string; input: Record<string, unknown> }[];
    }[];
  }>;
  meta: {
    sessionId: string;
    createdAt: string;
    lastActiveAt: string;
    durationMinutes: number;
    filesEdited: string[];
    gitBranch: string;
    toolBreakdown: Record<string, number>;
    subagentCount: number;
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
  representativePrompts: string[];
  suggestedPrompt: string;
  toolSignature: { tool: string; weight: number }[];
  dominantRole: "user-driven" | "tool-heavy" | "subagent-delegated";
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

// ─── Tool-IDF (frequency-bias mitigation) ───────────────────────────────────

interface ToolIdfResult {
  toolVocabulary: string[];
  toolVocabIndex: Map<string, number>;
  toolIdfWeights: Map<string, number>;
  vectors: Map<string, Float64Array>;
}

function buildToolIdf(sessions: SessionInput[]): ToolIdfResult {
  const n = sessions.length;

  // Collect all tool names across sessions
  const allTools = new Set<string>();
  const sessionToolCounts = new Map<string, Map<string, number>>();

  for (const s of sessions) {
    const toolCounts = new Map<string, number>();
    // Main session tools
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + count);
      allTools.add(tool);
    }
    // Subagent tools
    for (const sub of Object.values(s.subagents)) {
      for (const turn of sub.turns) {
        for (const tc of turn.toolCalls) {
          toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
          allTools.add(tc.toolName);
        }
      }
    }
    sessionToolCounts.set(s.sessionId, toolCounts);
  }

  // Build vocabulary and IDF
  const toolVocabulary = [...allTools].sort();
  const toolVocabIndex = new Map<string, number>();
  toolVocabulary.forEach((t, i) => toolVocabIndex.set(t, i));

  // Document frequency: how many sessions use each tool
  const df = new Map<string, number>();
  for (const [, counts] of sessionToolCounts) {
    for (const tool of counts.keys()) {
      df.set(tool, (df.get(tool) || 0) + 1);
    }
  }

  // IDF weights
  const toolIdfWeights = new Map<string, number>();
  for (const tool of toolVocabulary) {
    toolIdfWeights.set(tool, Math.log(n / (df.get(tool) || 1)));
  }

  // Build per-session tool vectors: log(1 + count) * tool_idf, then L2 normalize
  const vectors = new Map<string, Float64Array>();
  for (const s of sessions) {
    const counts = sessionToolCounts.get(s.sessionId)!;
    const vec = new Float64Array(toolVocabulary.length);

    for (const [tool, count] of counts) {
      const idx = toolVocabIndex.get(tool);
      if (idx !== undefined) {
        vec[idx] = Math.log(1 + count) * (toolIdfWeights.get(tool) || 1);
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    vectors.set(s.sessionId, vec);
  }

  return { toolVocabulary, toolVocabIndex, toolIdfWeights, vectors };
}

// ─── Structural Features ─────────────────────────────────────────────────────

// 7-dimensional vector: [userRatio, assistantRatio, toolCallRatio,
//                        subagentRatio, avgToolsPerTurn, editHeaviness, readHeaviness]
const STRUCTURAL_DIM = 7;

function buildStructuralVectors(sessions: SessionInput[]): Map<string, Float64Array> {
  const vectors = new Map<string, Float64Array>();

  for (const s of sessions) {
    const vec = new Float64Array(STRUCTURAL_DIM);
    const totalTurns = s.turns.length;
    if (totalTurns === 0) {
      vectors.set(s.sessionId, vec);
      continue;
    }

    // Count roles and tool usage
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    let subagentTurns = 0;
    let totalToolsInTurns = 0;

    for (const turn of s.turns) {
      if (turn.userPrompt) userCount++;
      if (turn.assistantTexts.length > 0) assistantCount++;
      const turnToolCount = turn.toolCalls.length;
      if (turnToolCount > 0) toolCallCount++;
      totalToolsInTurns += turnToolCount;

      // Check if any tool call is an Agent call
      if (turn.toolCalls.some((tc) => tc.toolName === "Agent")) {
        subagentTurns++;
      }
    }

    // Also count subagent involvement from subagents object
    const subagentCount = Object.keys(s.subagents).length;

    const totalEntries = userCount + assistantCount + toolCallCount || 1;
    vec[0] = userCount / totalEntries;         // userRatio
    vec[1] = assistantCount / totalEntries;     // assistantRatio
    vec[2] = toolCallCount / totalEntries;      // toolCallRatio
    vec[3] = subagentCount > 0
      ? Math.min(1, (subagentTurns + subagentCount) / totalTurns)
      : 0;                                      // subagentRatio
    vec[4] = Math.log(1 + totalToolsInTurns / totalTurns); // avgToolsPerTurn (log dampened)

    // Edit heaviness vs Read heaviness
    const tb = s.meta.toolBreakdown;
    const totalTools = Object.values(tb).reduce((a, b) => a + b, 0) || 1;
    vec[5] = ((tb["Edit"] || 0) + (tb["Write"] || 0)) / totalTools;  // editHeaviness
    vec[6] = ((tb["Read"] || 0) + (tb["Grep"] || 0) + (tb["Glob"] || 0)) / totalTools; // readHeaviness

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    vectors.set(s.sessionId, vec);
  }

  return vectors;
}

// ─── Truncated SVD (Latent Semantic Analysis) ────────────────────────────────

const WEIGHT_TEXT = 0.50;
const WEIGHT_TOOL = 0.25;
const WEIGHT_STRUCT = 0.25;

/**
 * Build a combined feature matrix from text, tool, and structural vectors.
 * Each group is L2-normalized, then scaled by its weight before concatenation.
 * Returns a dense row-major matrix (m × n) and sessionId ordering.
 */
function buildCombinedMatrix(
  sessionIds: string[],
  textVectors: Map<string, Float64Array>,
  toolVectors: Map<string, Float64Array>,
  structVectors: Map<string, Float64Array>,
  textDim: number,
  toolDim: number,
  structDim: number
): { matrix: Float64Array[]; totalDim: number } {
  const totalDim = textDim + toolDim + structDim;
  const wt = Math.sqrt(WEIGHT_TEXT);
  const wl = Math.sqrt(WEIGHT_TOOL);
  const ws = Math.sqrt(WEIGHT_STRUCT);

  const matrix: Float64Array[] = [];
  for (const sid of sessionIds) {
    const row = new Float64Array(totalDim);
    const tv = textVectors.get(sid);
    const lv = toolVectors.get(sid);
    const sv = structVectors.get(sid);

    if (tv) for (let i = 0; i < textDim; i++) row[i] = tv[i] * wt;
    if (lv) for (let i = 0; i < toolDim; i++) row[textDim + i] = lv[i] * wl;
    if (sv) for (let i = 0; i < structDim; i++) row[textDim + toolDim + i] = sv[i] * ws;

    matrix.push(row);
  }

  return { matrix, totalDim };
}

/**
 * Truncated SVD via power iteration on A·A^T (the Gram matrix).
 *
 * For m sessions × n features where m << n, computing the m×m Gram matrix
 * and extracting its top-k eigenvectors is far cheaper than full SVD.
 *
 * Returns:
 *   U_k: m × k (left singular vectors, session embeddings)
 *   sigma: k   (singular values)
 *   V_k: k × n (right singular vectors, latent topic axes — for interpretation)
 */
interface SvdResult {
  U: Float64Array[];    // m × k
  sigma: Float64Array;  // k
  V: Float64Array[];    // k × n (row-major: V[component][feature])
  k: number;
  sessionVectors: Map<string, Float64Array>; // sessionId → U·Σ (dense k-dim)
}

function truncatedSvd(
  sessionIds: string[],
  matrix: Float64Array[],
  totalDim: number,
  targetK: number
): SvdResult {
  const m = matrix.length;
  const n = totalDim;
  const k = Math.min(targetK, m - 1, n);

  // Step 1: Compute Gram matrix G = A · A^T (m × m)
  const G = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = i; j < m; j++) {
      let dot = 0;
      for (let d = 0; d < n; d++) {
        dot += matrix[i][d] * matrix[j][d];
      }
      G[i * m + j] = dot;
      G[j * m + i] = dot;
    }
  }

  // Step 2: Power iteration with deflation to extract top-k eigenvectors of G
  const eigenvectors: Float64Array[] = [];
  const eigenvalues: number[] = [];

  // Seeded PRNG for reproducibility
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let ki = 0; ki < k; ki++) {
    // Random initial vector
    const v = new Float64Array(m);
    for (let i = 0; i < m; i++) v[i] = nextRand() - 0.5;

    // Normalize
    let norm = 0;
    for (let i = 0; i < m; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < m; i++) v[i] /= norm;

    // Power iteration (50 iterations is more than enough for convergence)
    for (let iter = 0; iter < 50; iter++) {
      // w = G · v
      const w = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let j = 0; j < m; j++) {
          s += G[i * m + j] * v[j];
        }
        w[i] = s;
      }

      // Deflate: remove projections onto previously found eigenvectors
      for (let prev = 0; prev < ki; prev++) {
        const ev = eigenvectors[prev];
        let proj = 0;
        for (let i = 0; i < m; i++) proj += w[i] * ev[i];
        for (let i = 0; i < m; i++) w[i] -= proj * ev[i];
      }

      // Normalize
      norm = 0;
      for (let i = 0; i < m; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let i = 0; i < m; i++) v[i] = w[i] / norm;
    }

    // Eigenvalue = v^T G v
    let eigenvalue = 0;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += G[i * m + j] * v[j];
      eigenvalue += v[i] * s;
    }

    eigenvectors.push(new Float64Array(v));
    eigenvalues.push(Math.max(0, eigenvalue));
  }

  // Step 3: Singular values = sqrt(eigenvalues of G)
  const sigma = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    sigma[i] = Math.sqrt(eigenvalues[i]);
  }

  // Step 4: Right singular vectors V = A^T · U · Σ^{-1}
  // V[ki] is a n-dimensional vector
  const V: Float64Array[] = [];
  for (let ki = 0; ki < k; ki++) {
    const vk = new Float64Array(n);
    if (sigma[ki] > 1e-12) {
      const invSigma = 1 / sigma[ki];
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let i = 0; i < m; i++) {
          s += matrix[i][j] * eigenvectors[ki][i];
        }
        vk[j] = s * invSigma;
      }
    }
    V.push(vk);
  }

  // Step 5: Session vectors = U · Σ (scaled embeddings)
  const sessionVectors = new Map<string, Float64Array>();
  for (let i = 0; i < m; i++) {
    const vec = new Float64Array(k);
    for (let ki = 0; ki < k; ki++) {
      vec[ki] = eigenvectors[ki][i] * sigma[ki];
    }
    // L2 normalize for cosine-based clustering
    let norm = 0;
    for (let d = 0; d < k; d++) norm += vec[d] * vec[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < k; d++) vec[d] /= norm;

    sessionVectors.set(sessionIds[i], vec);
  }

  return { U: eigenvectors, sigma, V, k, sessionVectors };
}

/**
 * Interpret latent dimensions from V matrix.
 * Returns top-N terms per latent dimension, useful for cluster labeling.
 */
interface LatentDimension {
  index: number;
  varianceRatio: number; // σ² / Σσ² — how much this dimension explains
  topTerms: { term: string; weight: number }[];
  topTools: { tool: string; weight: number }[];
}

function interpretLatentDimensions(
  svd: SvdResult,
  textVocabulary: string[],
  toolVocabulary: string[],
  textDim: number,
  toolDim: number,
  topN: number = 5
): LatentDimension[] {
  const totalVariance = svd.sigma.reduce((s, v) => s + v * v, 0);
  const dimensions: LatentDimension[] = [];

  for (let ki = 0; ki < svd.k; ki++) {
    const v = svd.V[ki];
    const varianceRatio = totalVariance > 0
      ? (svd.sigma[ki] * svd.sigma[ki]) / totalVariance
      : 0;

    // Top text terms (from text portion of V)
    const textScored: { term: string; weight: number }[] = [];
    for (let i = 0; i < textDim && i < textVocabulary.length; i++) {
      if (Math.abs(v[i]) > 0.01) {
        textScored.push({ term: textVocabulary[i], weight: Math.abs(v[i]) });
      }
    }
    textScored.sort((a, b) => b.weight - a.weight);

    // Top tools (from tool portion of V)
    const toolScored: { tool: string; weight: number }[] = [];
    for (let i = 0; i < toolDim && i < toolVocabulary.length; i++) {
      const idx = textDim + i;
      if (Math.abs(v[idx]) > 0.01) {
        toolScored.push({ tool: toolVocabulary[i], weight: Math.abs(v[idx]) });
      }
    }
    toolScored.sort((a, b) => b.weight - a.weight);

    dimensions.push({
      index: ki,
      varianceRatio: Math.round(varianceRatio * 10000) / 10000,
      topTerms: textScored.slice(0, topN),
      topTools: toolScored.slice(0, topN),
    });
  }

  return dimensions;
}

// ─── Prompt Generation Helpers ───────────────────────────────────────────────

const ACTION_VERBS_EN = new Set([
  "fix", "add", "implement", "create", "update", "refactor", "remove",
  "delete", "move", "rename", "test", "debug", "optimize", "migrate",
  "deploy", "configure", "setup", "integrate", "build", "review",
  "investigate", "analyze", "check", "resolve", "extract", "convert",
]);

const ACTION_VERBS_JA: [RegExp, string][] = [
  [/修正/, "fix"], [/追加/, "add"], [/実装/, "implement"],
  [/作成|作って/, "create"], [/更新/, "update"], [/リファクタ/, "refactor"],
  [/削除/, "remove"], [/テスト/, "test"], [/デバッグ/, "debug"],
  [/最適化/, "optimize"], [/移行|マイグレ/, "migrate"],
  [/設定|セットアップ/, "configure"], [/統合/, "integrate"],
  [/ビルド/, "build"], [/レビュー/, "review"], [/調査/, "investigate"],
  [/確認|チェック/, "check"], [/解決/, "resolve"],
];

function extractDominantAction(prompts: string[]): string {
  const actionCounts = new Map<string, number>();

  for (const prompt of prompts) {
    const lower = prompt.toLowerCase();
    // English verbs
    const words = lower.split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/[^a-z]/g, "");
      if (ACTION_VERBS_EN.has(clean)) {
        actionCounts.set(clean, (actionCounts.get(clean) || 0) + 1);
      }
    }
    // Japanese verbs
    for (const [pattern, verb] of ACTION_VERBS_JA) {
      if (pattern.test(prompt)) {
        actionCounts.set(verb, (actionCounts.get(verb) || 0) + 1);
      }
    }
  }

  if (actionCounts.size === 0) return "work on";
  return [...actionCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function selectRepresentativePrompts(
  memberSessions: SessionInput[],
  clusterCentroid: Float64Array,
  tfidfResult: TfidfResult,
  maxCount: number = 3
): string[] {
  const scored: { prompt: string; score: number }[] = [];

  for (const s of memberSessions) {
    const sessionVec = tfidfResult.vectors.get(s.sessionId);
    if (!sessionVec) continue;

    const sim = cosineSimilarity(sessionVec, clusterCentroid);

    for (const turn of s.turns) {
      if (turn.userPrompt && turn.userPrompt.length > 10) {
        scored.push({ prompt: turn.userPrompt, score: sim });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate similar prompts
  const selected: string[] = [];
  for (const { prompt } of scored) {
    const trimmed = prompt.length > 150 ? prompt.slice(0, 150) + "..." : prompt;
    if (!selected.some((s) => s === trimmed)) {
      selected.push(trimmed);
      if (selected.length >= maxCount) break;
    }
  }

  return selected;
}

function generateSuggestedPrompt(
  memberSessions: SessionInput[],
  keywords: string[],
  toolIdf: ToolIdfResult
): string {
  // Collect all user prompts
  const allPrompts = memberSessions.flatMap((s) =>
    s.turns.map((t) => t.userPrompt).filter(Boolean)
  );

  // Extract dominant action
  const action = extractDominantAction(allPrompts);

  // Domain keywords (top 3)
  const domain = keywords.slice(0, 3).join("/");

  // Top tools by Tool-IDF weighted usage in this cluster
  const clusterToolCounts = new Map<string, number>();
  for (const s of memberSessions) {
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      clusterToolCounts.set(tool, (clusterToolCounts.get(tool) || 0) + count);
    }
  }
  const toolScores = [...clusterToolCounts.entries()].map(([tool, count]) => ({
    tool,
    score: Math.log(1 + count) * (toolIdf.toolIdfWeights.get(tool) || 1),
  }));
  toolScores.sort((a, b) => b.score - a.score);
  const topTools = toolScores.slice(0, 3).map((t) => t.tool);

  return `${action} ${domain} — tools: ${topTools.join(", ")}`;
}

function computeToolSignature(
  memberSessions: SessionInput[],
  toolIdf: ToolIdfResult
): { tool: string; weight: number }[] {
  const clusterToolCounts = new Map<string, number>();
  for (const s of memberSessions) {
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      clusterToolCounts.set(tool, (clusterToolCounts.get(tool) || 0) + count);
    }
  }

  const scored = [...clusterToolCounts.entries()].map(([tool, count]) => ({
    tool,
    weight: Math.round(Math.log(1 + count) * (toolIdf.toolIdfWeights.get(tool) || 1) * 100) / 100,
  }));
  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, 5);
}

function classifyDominantRole(
  memberSessions: SessionInput[]
): "user-driven" | "tool-heavy" | "subagent-delegated" {
  let totalUserTurns = 0;
  let totalToolCalls = 0;
  let totalSubagentCalls = 0;

  for (const s of memberSessions) {
    for (const turn of s.turns) {
      if (turn.userPrompt) totalUserTurns++;
      totalToolCalls += turn.toolCalls.length;
      totalSubagentCalls += turn.toolCalls.filter((tc) => tc.toolName === "Agent").length;
    }
    totalSubagentCalls += Object.keys(s.subagents).length;
  }

  const total = totalUserTurns + totalToolCalls + totalSubagentCalls || 1;
  const subagentRatio = totalSubagentCalls / total;
  const toolRatio = totalToolCalls / total;

  if (subagentRatio > 0.15) return "subagent-delegated";
  if (toolRatio > 0.6) return "tool-heavy";
  return "user-driven";
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

function agglomerativeClusteringFromDistMatrix(
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

function clusterWithThresholdFromDistMatrix(
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
function splitOversizedClusters(
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

// ─── Topic Node Construction ────────────────────────────────────────────────

function buildTopicNodes(
  clusterMembers: number[][],
  sessions: SessionInput[],
  tfidf: TfidfResult,
  toolIdf: ToolIdfResult
): TopicNode[] {
  const topics: TopicNode[] = [];

  for (let ci = 0; ci < clusterMembers.length; ci++) {
    const members = clusterMembers[ci];
    const memberSessions = members.map((idx) => sessions[idx]);

    // Compute cluster centroid (TF-IDF text only, for keyword extraction)
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

    // New fields: prompts, tool signature, role classification
    // L2 normalize centroid for prompt selection
    let centroidNorm = 0;
    for (let k = 0; k < centroid.length; k++) centroidNorm += centroid[k] * centroid[k];
    centroidNorm = Math.sqrt(centroidNorm);
    const normalizedCentroid = new Float64Array(centroid.length);
    if (centroidNorm > 0) {
      for (let k = 0; k < centroid.length; k++) normalizedCentroid[k] = centroid[k] / centroidNorm;
    }

    const representativePrompts = selectRepresentativePrompts(
      memberSessions, normalizedCentroid, tfidf
    );
    const suggestedPrompt = generateSuggestedPrompt(
      memberSessions, keywords, toolIdf
    );
    const toolSignature = computeToolSignature(memberSessions, toolIdf);
    const dominantRole = classifyDominantRole(memberSessions);

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
      representativePrompts,
      suggestedPrompt,
      toolSignature,
      dominantRole,
    });
  }

  return topics;
}

// ─── Topic Edge Construction ────────────────────────────────────────────────

function buildTopicEdges(
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

  // Step 1: Extract session text documents (for TF-IDF)
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

  // Step 1b: Build Tool-IDF and Structural vectors (always needed, even for single topic)
  const toolIdf = buildToolIdf(activeSessions);
  console.log(
    `  [Knowledge Graph] Tool-IDF: ${toolIdf.toolVocabulary.length} tool types`
  );

  const structVectors = buildStructuralVectors(activeSessions);
  console.log(
    `  [Knowledge Graph] Structural features: ${STRUCTURAL_DIM} dimensions`
  );

  if (activeSessions.length < 2) {
    // Single session: create one topic
    const emptyTfidf: TfidfResult = { vocabulary: [], vocabIndex: new Map(), vectors: new Map() };
    const singleTopic = buildTopicNodes(
      [sessionIds.map((_, i) => i)],
      activeSessions,
      emptyTfidf,
      toolIdf
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

  // Step 2: TF-IDF (text features)
  const tfidf = buildTfidf(documents);
  console.log(
    `  [Knowledge Graph] TF-IDF: ${tfidf.vocabulary.length} terms in vocabulary`
  );

  // Step 3: Build combined matrix and apply Truncated SVD
  const textDim = tfidf.vocabulary.length;
  const toolDim = toolIdf.toolVocabulary.length;
  const { matrix, totalDim } = buildCombinedMatrix(
    sessionIds,
    tfidf.vectors,
    toolIdf.vectors,
    structVectors,
    textDim,
    toolDim,
    STRUCTURAL_DIM
  );

  // Choose k: enough dimensions to capture nuanced clusters.
  // Use m/4 clamped to [20, 80] — higher than sqrt(m) to preserve more signal.
  const targetK = Math.min(80, Math.max(20, Math.round(activeSessions.length / 4)));
  const svd = truncatedSvd(sessionIds, matrix, totalDim, targetK);
  console.log(
    `  [Knowledge Graph] SVD: ${totalDim}d → ${svd.k}d latent space (top-3 σ: ${[...svd.sigma.slice(0, 3)].map(s => s.toFixed(2)).join(', ')})`
  );

  // Interpret latent dimensions (for logging and potential use in labeling)
  const latentDims = interpretLatentDimensions(
    svd, tfidf.vocabulary, toolIdf.toolVocabulary, textDim, toolDim, 5
  );
  // Log top 3 latent dimensions
  for (const dim of latentDims.slice(0, 3)) {
    const terms = dim.topTerms.slice(0, 3).map(t => t.term).join(', ');
    const tools = dim.topTools.slice(0, 2).map(t => t.tool).join(', ');
    console.log(
      `    dim-${dim.index}: var=${(dim.varianceRatio * 100).toFixed(1)}% terms=[${terms}] tools=[${tools}]`
    );
  }

  // Step 4: Clustering on dense SVD vectors (cosine distance is now reliable)
  let clusterMembers: number[][];
  if (activeSessions.length < 5) {
    clusterMembers = sessionIds.map((_, i) => [i]);
  } else {
    // Build distance matrix from SVD session vectors
    const distKey = (i: number, j: number) => i < j ? `${i}:${j}` : `${j}:${i}`;
    const svdDist = new Map<string, number>();
    for (let i = 0; i < sessionIds.length; i++) {
      const vi = svd.sessionVectors.get(sessionIds[i])!;
      for (let j = i + 1; j < sessionIds.length; j++) {
        const vj = svd.sessionVectors.get(sessionIds[j])!;
        svdDist.set(distKey(i, j), cosineDistance(vi, vj));
      }
    }

    clusterMembers = agglomerativeClusteringFromDistMatrix(
      sessionIds,
      svdDist
    );

    // Split oversized clusters
    clusterMembers = splitOversizedClusters(
      clusterMembers,
      activeSessions.length,
      svdDist
    );
  }

  console.log(
    `  [Knowledge Graph] Clustering: ${clusterMembers.length} topics from ${activeSessions.length} sessions`
  );

  // Step 5: Build topic nodes
  const topics = buildTopicNodes(clusterMembers, activeSessions, tfidf, toolIdf);

  // Step 6: Build topic edges (using SVD vectors for semantic similarity)
  const edges = buildTopicEdges(topics, activeSessions, tfidf, svd);
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
