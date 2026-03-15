// === ViewMode ===
export type ViewMode = 'overview' | 'playback' | 'knowledge'

// === Session Index (loaded at app start) ===
export interface SessionIndex {
  generatedAt: string
  totalSessions: number
  projects: ProjectSummary[]
  sessions: SessionSummary[] // sorted by createdAt desc
}

export interface ProjectSummary {
  name: string // e.g. "chigichan24/crune"
  sessionCount: number
  totalDurationMinutes: number
}

export interface SessionSummary {
  sessionId: string
  project: string
  cwd: string
  gitBranch: string | null
  slug: string | null
  createdAt: string // ISO8601
  lastActiveAt: string // ISO8601
  durationMinutes: number
  turnCount: number
  toolBreakdown: Record<string, number>
  toolCallCount?: number
  firstUserPrompt: string // truncated to 200 chars
  summaryText?: string // representative prompt (max 300 chars)
  keywords?: string[] // top keywords from user prompts
  scope?: string // common directory prefix of edited files
  workType?: 'investigation' | 'implementation' | 'debugging' | 'planning'
  permissionMode: string | null
  subagentCount: number
}

// === Session Detail (loaded on demand for playback) ===
export interface SessionDetail {
  sessionId: string
  meta: SessionMeta
  turns: ConversationTurn[]
  subagents: Record<string, SubagentSession>
  linkedPlan: LinkedPlan | null
}

export interface SessionMeta {
  project: string
  cwd: string
  branch: string | null
  slug: string | null
  version: string | null
  createdAt: string
  lastActiveAt: string
  durationMinutes: number
  permissionMode: string | null
}

export interface ConversationTurn {
  turnIndex: number
  timestamp: string
  userPrompt: string
  assistantThinking: string[]
  assistantTexts: string[]
  toolCalls: ToolCall[]
  model?: string
}

export interface ToolCall {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  result?: string
  subagentId?: string
}

export interface SubagentSession {
  agentId: string
  agentType: string
  turns: ConversationTurn[]
  model?: string
}

export interface LinkedPlan {
  slug: string
  content: string
}

// === Session Overview (cross-session analytics) ===
export interface SessionOverviewData {
  generatedAt: string
  activityHeatmap: number[][] // [7][24] dayOfWeek x hour
  projectDistribution: ProjectDistItem[]
  weeklyToolTrends: WeeklyToolTrend[]
  durationDistribution: DurationBucket[]
  topFiles: TopFile[]
  modelUsage: ModelUsageItem[]
  knowledgeGraph: KnowledgeGraph
  tacitKnowledge: TacitKnowledge
}

export interface ProjectDistItem {
  name: string
  sessionCount: number
  totalDurationMinutes: number
}

export interface WeeklyToolTrend {
  week: string // e.g. "2025-W01"
  tools: Record<string, number>
}

export interface DurationBucket {
  bucket: string // e.g. "0-5min", "5-15min"
  count: number
}

export interface TopFile {
  file: string
  editCount: number
}

export interface ModelUsageItem {
  model: string
  count: number
}

// === Knowledge Graph (Semantic Topic Graph) ===
export type SemanticEdgeType =
  | 'semantic-similarity'
  | 'shared-module'
  | 'workflow-continuation'
  | 'cross-project-bridge'

export interface ReusabilityScore {
  overall: number
  frequency: number
  timeCost: number
  crossProjectScore: number
  recency: number
}

export interface TopicNode {
  id: string // "topic-001"
  label: string // auto-generated from top keywords + project
  keywords: string[] // top-5 TF-IDF terms
  project: string // dominant project
  projects: string[] // all contributing projects
  sessionIds: string[] // member session IDs
  sessionCount: number
  totalDurationMinutes: number
  totalToolCalls: number
  firstSeen: string
  lastSeen: string
  betweennessCentrality: number
  degreeCentrality: number
  communityId: number // Louvain community
  representativePrompts: string[] // top-3 user prompts closest to cluster centroid
  suggestedPrompt: string // heuristic template: "action domain — tools: ..."
  toolSignature: { tool: string; weight: number }[] // top tools by Tool-IDF weight
  dominantRole: 'user-driven' | 'tool-heavy' | 'subagent-delegated'
  reusabilityScore: ReusabilityScore
}

export interface TopicEdge {
  source: string // topic ID
  target: string // topic ID
  type: SemanticEdgeType
  strength: number // 0-1
  label: string // human-readable edge description
  signals: {
    semanticSimilarity: number
    fileOverlap: number
    sessionOverlap: number
  }
}

export interface KnowledgeCommunity {
  id: number
  topicIds: string[]
  label: string
  dominantProject: string
}

export interface KnowledgeGraphMetrics {
  totalTopics: number
  totalEdges: number
  graphDensity: number
  modularity: number
  isolatedTopicCount: number
  bridgeTopicIds: string[]
}

export interface KnowledgeGraph {
  nodes: TopicNode[]
  edges: TopicEdge[]
  communities: KnowledgeCommunity[]
  metrics: KnowledgeGraphMetrics
}

// === Enriched Tool Sequence ===
export type ToolCategory = 'read' | 'write' | 'execute' | 'delegate' | 'search'

export interface EnrichedToolStep {
  toolName: string
  category: ToolCategory
  targetPattern?: string
}

export interface EnrichedToolSequence {
  sequence: EnrichedToolStep[]
  count: number
  sessionIds: string[]
  projects: string[]
}

// === Skill Candidate ===
export interface SkillCandidate {
  topicId: string
  reusabilityScore: number
  skillMarkdown: string
  synthesizedMarkdown?: string
  hookJson?: string
}

// === Tacit Knowledge ===
export interface TacitKnowledge {
  workflowPatterns: WorkflowPattern[]
  commonToolSequences: ToolSequence[]
  enrichedToolSequences: EnrichedToolSequence[]
  skillCandidates: SkillCandidate[]
  painPoints: PainPoints
}

export interface WorkflowPattern {
  project: string
  planModeUsage: number
  totalSessions: number
}

export interface ToolSequence {
  sequence: string[] // e.g. ["Grep", "Read", "Edit"]
  count: number
}

export interface PainPoints {
  longSessions: LongSession[]
  hotFiles: HotFile[]
}

export interface LongSession {
  sessionId: string
  durationMinutes: number
  medianDuration: number
}

export interface HotFile {
  file: string
  editCount: number
  sessionId: string
}

// === Graph Context for Skill Synthesis ===
export interface ConnectedTopicInfo {
  id: string
  label: string
  keywords: string[]
  edgeType: SemanticEdgeType
  strength: number
  direction: 'incoming' | 'outgoing'
}

export interface GraphContext {
  connectedTopics: ConnectedTopicInfo[]
  community?: { label: string; memberCount: number }
  isBridgeTopic: boolean
}

// === Skill Synthesis (LLM-based) ===
export interface SynthesisRequest {
  skillCandidate: SkillCandidate
  topicNode: TopicNode
  enrichedSequences?: EnrichedToolSequence[]
  graphContext?: GraphContext
}

export interface SynthesisResponse {
  success: boolean
  synthesizedMarkdown?: string
  error?: string
}
