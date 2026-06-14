/**
 * knowledge-graph-builder.ts
 *
 * Barrel re-export for backward compatibility.
 * Implementation is in ./knowledge-graph/ submodules.
 */

export {
  // Main entry point
  buildSemanticKnowledgeGraph,
  // Types
  type SessionInput,
  type SemanticKnowledgeGraph,
  type SemanticEdgeType,
  type TopicNode,
  type TopicEdge,
  type KnowledgeCommunity,
  type KnowledgeGraphMetrics,
  type ToolIdfResult,
  type Bm25Result,
  type SvdResult,
  type LatentDimension,
  // Tokenizer
  tokenize,
  splitCamelCase,
  extractPathTokens,
  isNoiseToken,
  // TF-IDF
  buildBm25,
  // Feature extraction
  buildToolIdf,
  buildStructuralVectors,
  // SVD
  buildCombinedMatrix,
  truncatedSvd,
  interpretLatentDimensions,
  // Similarity
  cosineSimilarity,
  cosineDistance,
  // Clustering
  agglomerativeClusteringFromDistMatrix,
  findElbowThreshold,
  clusterWithThresholdFromDistMatrix,
  splitOversizedClusters,
  mergeNarrowClusters,
  // Topic nodes
  extractDominantAction,
  selectRepresentativePrompts,
  generateSuggestedPrompt,
  computeToolSignature,
  classifyDominantRole,
  buildTopicNodes,
  // Edges
  buildTopicEdges,
  classifyEdge,
  findSharedKeywords,
  findCommonPathPrefix,
  // Community
  louvainDetection,
  brandesBetweenness,
  // Reusability
  computeReusabilityScores,
  // Facets
  type FacetsData,
  type FacetsInsightsSummary,
  type TopicFacetsSummary,
  readFacetsDir,
  normalizeGoalCategory,
  helpfulnessToScore,
  aggregateFacetsForTopic,
  buildTopicFacetsSummary,
  attachFacetsSummaries,
  // RAG embedding pipeline + retriever (issue #32)
  extractChunks,
  embedSessions,
  quantize,
  dequantize,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIM,
  type EmbeddingBackend,
  type ChunkMeta,
  type ExtractedChunk,
  type EmbedResult,
  type EmbeddingMeta,
  writeEmbeddingIndex,
  readEmbeddingIndex,
  createTransformersBackend,
  createRetriever,
  createRetrieverFromIndex,
  type Retriever,
  type RetrievedChunk,
} from "./knowledge-graph/index.js";
