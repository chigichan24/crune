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
  type TfidfResult,
  type SvdResult,
  type LatentDimension,
  // Tokenizer
  tokenize,
  splitCamelCase,
  extractPathTokens,
  isNoiseToken,
  // TF-IDF
  buildTfidf,
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
  // Facets
  type FacetsData,
  type FacetsInsightsSummary,
  readFacetsDir,
  normalizeGoalCategory,
  helpfulnessToScore,
  aggregateFacetsForTopic,
} from "./knowledge-graph/index.js";
