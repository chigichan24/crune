/**
 * Type definitions for semantic knowledge graph construction.
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

// ─── Internal result types ──────────────────────────────────────────────────

export interface ToolIdfResult {
  toolVocabulary: string[];
  toolVocabIndex: Map<string, number>;
  toolIdfWeights: Map<string, number>;
  vectors: Map<string, Float64Array>;
}

export interface TfidfResult {
  vocabulary: string[];
  vocabIndex: Map<string, number>;
  vectors: Map<string, Float64Array>;
}

export interface SvdResult {
  U: Float64Array[];    // m × k
  sigma: Float64Array;  // k
  V: Float64Array[];    // k × n (row-major: V[component][feature])
  k: number;
  sessionVectors: Map<string, Float64Array>; // sessionId → U·Σ (dense k-dim)
}

export interface LatentDimension {
  index: number;
  varianceRatio: number;
  topTerms: { term: string; weight: number }[];
  topTools: { tool: string; weight: number }[];
}
