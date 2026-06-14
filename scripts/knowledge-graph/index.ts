/**
 * Semantic knowledge graph construction from Claude Code session data.
 * Pipeline: BM25 + Tool-IDF + Structure → SVD (Latent Semantic) → Clustering → Louvain → Brandes
 */

import type {
  SessionInput,
  SemanticKnowledgeGraph,
  KnowledgeGraphMetrics,
  KnowledgeGraphOptions,
  Bm25Result,
} from "./types.js";
import { STRUCTURAL_DIM } from "./constants.js";
import { tokenize } from "./tokenizer.js";
import { buildBm25 } from "./bm25.js";
import { buildToolIdf, buildStructuralVectors } from "./feature-extraction.js";
import { buildCombinedMatrix, truncatedSvd, interpretLatentDimensions } from "./svd.js";
import { cosineDistance } from "./similarity.js";
import {
  agglomerativeClusteringFromDistMatrix,
  splitOversizedClusters,
  mergeNarrowClusters,
} from "./clustering.js";
import { readFacetsDir } from "./facets-reader.js";
import { buildTopicNodes } from "./topic-nodes.js";
import { buildTopicEdges } from "./edges.js";
import { louvainDetection, brandesBetweenness } from "./community.js";
import { computeReusabilityScores } from "./reusability.js";
import { extractEnrichedSequences } from "./tool-pattern.js";
import { generateSkillCandidates } from "./skill-generator.js";

// Re-export all public types and key functions
export type {
  SessionInput,
  SemanticKnowledgeGraph,
  SemanticEdgeType,
  TopicNode,
  TopicEdge,
  KnowledgeCommunity,
  KnowledgeGraphMetrics,
  KnowledgeGraphOptions,
  ToolIdfResult,
  Bm25Result,
  SvdResult,
  LatentDimension,
  ReusabilityScore,
  ToolCategory,
  EnrichedToolStep,
  EnrichedToolSequence,
  SkillCandidate,
  FacetsData,
  FacetsInsightsSummary,
} from "./types.js";

export { tokenize, splitCamelCase, extractPathTokens, isNoiseToken } from "./tokenizer.js";
export { buildBm25 } from "./bm25.js";
export { buildToolIdf, buildStructuralVectors } from "./feature-extraction.js";
export { buildCombinedMatrix, truncatedSvd, interpretLatentDimensions } from "./svd.js";
export { cosineSimilarity, cosineDistance } from "./similarity.js";
export {
  agglomerativeClusteringFromDistMatrix,
  findElbowThreshold,
  clusterWithThresholdFromDistMatrix,
  splitOversizedClusters,
  mergeNarrowClusters,
} from "./clustering.js";
export {
  extractDominantAction,
  selectRepresentativePrompts,
  generateSuggestedPrompt,
  computeToolSignature,
  classifyDominantRole,
  buildTopicNodes,
} from "./topic-nodes.js";
export {
  buildTopicEdges,
  classifyEdge,
  findSharedKeywords,
  findCommonPathPrefix,
} from "./edges.js";
export { louvainDetection, brandesBetweenness } from "./community.js";
export { computeReusabilityScores, computeSessionHumanSignal, aggregateHumanSignal, HUMAN_SIGNAL_WEIGHT } from "./reusability.js";
export type { SessionHumanSignal } from "./reusability.js";
export { abstractToolCall, extractEnrichedSequences } from "./tool-pattern.js";
export { generateSkillMarkdown, generateHookJson, generateSkillCandidates } from "./skill-generator.js";
export { readFacetsDir, normalizeGoalCategory, helpfulnessToScore, aggregateFacetsForTopic, buildTopicFacetsSummary } from "./facets-reader.js";

// ─── RAG embedding pipeline + retriever (issue #32) ──────────────────────────
export {
  extractChunks,
  embedSessions,
  quantize,
  dequantize,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIM,
  QUANT_SCALE,
  QUANT_MAX_ERROR,
} from "./embedder.js";
export type {
  EmbeddingBackend,
  ChunkMeta,
  ExtractedChunk,
  EmbedResult,
  EmbedOptions,
  EmbeddingMeta,
} from "./embedder.js";
export {
  writeEmbeddingIndex,
  readEmbeddingIndex,
  createTransformersBackend,
  INDEX_FILENAME,
  META_FILENAME,
} from "./embedding-io.js";
export type { LoadedEmbeddingIndex } from "./embedding-io.js";
export {
  createRetriever,
  createRetrieverFromIndex,
} from "./retriever.js";
export type { Retriever, RetrievedChunk, RetrieveOptions } from "./retriever.js";

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function buildSemanticKnowledgeGraph(
  sessions: SessionInput[],
  options: KnowledgeGraphOptions = {}
): SemanticKnowledgeGraph {
  const { enableLouvain = true, enableBrandes = true, facetsDir, humanSignalMap } = options;

  console.error(`  [Knowledge Graph] Processing ${sessions.length} sessions...`);

  // Read facets data if directory is provided
  const facetsMap = facetsDir ? readFacetsDir(facetsDir) : new Map();
  if (facetsDir) {
    console.error(`  [Knowledge Graph] Facets: ${facetsMap.size} sessions with /insights data`);
  }

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
      enrichedToolSequences: [],
      skillCandidates: [],
    };
  }

  // Step 1: Extract session text documents (for BM25)
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

  console.error(
    `  [Knowledge Graph] Tokenized ${documents.size} sessions (${sessions.length - documents.size} excluded: empty)`
  );

  // Filter sessions to only those with documents
  const activeSessions = sessions.filter((s) => documents.has(s.sessionId));
  const sessionIds = activeSessions.map((s) => s.sessionId);

  // Step 1b: Build Tool-IDF and Structural vectors (always needed, even for single topic)
  const toolIdf = buildToolIdf(activeSessions);
  console.error(
    `  [Knowledge Graph] Tool-IDF: ${toolIdf.toolVocabulary.length} tool types`
  );

  const structVectors = buildStructuralVectors(activeSessions);
  console.error(
    `  [Knowledge Graph] Structural features: ${STRUCTURAL_DIM} dimensions`
  );

  // Extract enriched tool sequences from all sessions
  const enrichedSequences = extractEnrichedSequences(activeSessions);
  console.error(
    `  [Knowledge Graph] Enriched sequences: ${enrichedSequences.length} patterns detected`
  );

  if (activeSessions.length < 2) {
    // Single session: create one topic
    const emptyBm25: Bm25Result = { vocabulary: [], vocabIndex: new Map(), vectors: new Map() };
    const singleTopic = buildTopicNodes(
      [sessionIds.map((_, i) => i)],
      activeSessions,
      emptyBm25,
      toolIdf,
      facetsMap
    );
    computeReusabilityScores(singleTopic, new Date(), facetsMap, humanSignalMap);
    const skillCandidates = generateSkillCandidates(singleTopic, enrichedSequences);
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
      enrichedToolSequences: enrichedSequences,
      skillCandidates,
    };
  }

  // Step 2: BM25 (text features)
  const bm25 = buildBm25(documents);
  console.error(
    `  [Knowledge Graph] BM25: ${bm25.vocabulary.length} terms in vocabulary`
  );

  // Step 3: Build combined matrix and apply Truncated SVD
  const textDim = bm25.vocabulary.length;
  const toolDim = toolIdf.toolVocabulary.length;
  const { matrix, totalDim } = buildCombinedMatrix(
    sessionIds,
    bm25.vectors,
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
  console.error(
    `  [Knowledge Graph] SVD: ${totalDim}d → ${svd.k}d latent space (top-3 σ: ${[...svd.sigma.slice(0, 3)].map(s => s.toFixed(2)).join(', ')})`
  );

  // Interpret latent dimensions (for logging and potential use in labeling)
  const latentDims = interpretLatentDimensions(
    svd, bm25.vocabulary, toolIdf.toolVocabulary, textDim, toolDim, 5
  );
  // Log top 3 latent dimensions
  for (const dim of latentDims.slice(0, 3)) {
    const terms = dim.topTerms.slice(0, 3).map(t => t.term).join(', ');
    const tools = dim.topTools.slice(0, 2).map(t => t.tool).join(', ');
    console.error(
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

    // Merge narrow clusters using facets goal categories
    if (facetsMap.size > 0) {
      const beforeCount = clusterMembers.length;
      clusterMembers = mergeNarrowClusters(
        clusterMembers,
        sessionIds,
        facetsMap,
        svdDist
      );
      if (clusterMembers.length < beforeCount) {
        console.error(
          `  [Knowledge Graph] Merged narrow clusters: ${beforeCount} → ${clusterMembers.length} topics`
        );
      }
    }
  }

  console.error(
    `  [Knowledge Graph] Clustering: ${clusterMembers.length} topics from ${activeSessions.length} sessions`
  );

  // Step 5: Build topic nodes
  const topics = buildTopicNodes(clusterMembers, activeSessions, bm25, toolIdf, facetsMap);

  // Step 5b: Compute reusability scores
  computeReusabilityScores(topics, new Date(), facetsMap, humanSignalMap);
  console.error(
    `  [Knowledge Graph] Reusability scores computed for ${topics.length} topics`
  );

  // Step 6: Build topic edges (using SVD vectors for semantic similarity)
  const edges = buildTopicEdges(topics, activeSessions, bm25, svd);
  console.error(`  [Knowledge Graph] Edges: ${edges.length} topic connections`);

  // Step 7: Louvain community detection (optional)
  let communities;
  let modularity: number;
  if (enableLouvain) {
    const louvainResult = louvainDetection(topics, edges);
    communities = louvainResult.communities;
    modularity = louvainResult.modularity;
    console.error(
      `  [Knowledge Graph] Communities: ${communities.length} (modularity: ${modularity.toFixed(3)})`
    );
  } else {
    // Fallback: each cluster is its own community
    communities = topics.map((t, i) => ({
      id: i,
      topicIds: [t.id],
      label: t.label,
      dominantProject: t.project,
    }));
    // Assign communityId to topics
    for (let i = 0; i < topics.length; i++) {
      topics[i].communityId = i;
    }
    modularity = 0;
    console.error(
      `  [Knowledge Graph] Communities: ${communities.length} (Louvain disabled, using cluster-based)`
    );
  }

  // Step 8: Graph metrics (Brandes + degree centrality, optional)
  if (enableBrandes) {
    brandesBetweenness(topics, edges);
  } else {
    // Compute degree centrality only
    const nTopics = topics.length;
    const degreeMap = new Map<string, number>();
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    }
    for (const t of topics) {
      t.degreeCentrality = nTopics > 1
        ? (degreeMap.get(t.id) || 0) / (nTopics - 1)
        : 0;
    }
    console.error(`  [Knowledge Graph] Brandes disabled, degree centrality only`);
  }

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

  // Step 9: Generate skill candidates
  const skillCandidates = generateSkillCandidates(topics, enrichedSequences);
  console.error(
    `  [Knowledge Graph] Skill candidates: ${skillCandidates.length} generated`
  );

  console.error(
    `  [Knowledge Graph] Done. ${nTopics} topics, ${edges.length} edges, ${communities.length} communities, ${isolatedCount} isolated`
  );

  return { nodes: topics, edges, communities, metrics, enrichedToolSequences: enrichedSequences, skillCandidates };
}
