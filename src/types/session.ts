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
  firstUserPrompt: string // truncated to 200 chars
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
  projectDir: string
  cwd: string
  gitBranch: string | null
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
  assistantBlocks: AssistantBlock[]
}

export type AssistantBlock = ThinkingBlock | TextBlock | ToolUseBlock

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string // truncated to 5000 chars
  truncated: boolean
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: ToolInput
  result: ToolResult | null
  subagentId: string | null // non-null if name === 'Agent'
}

// Tool inputs vary by tool name - store relevant fields
export interface ToolInput {
  // Common
  command?: string // Bash
  description?: string // Bash, Agent
  file_path?: string // Read, Edit, Write
  pattern?: string // Grep, Glob
  old_string?: string // Edit
  new_string?: string // Edit
  content?: string // Write (truncated to 500 chars preview)
  contentLength?: number // Write (original length)
  prompt?: string // Agent
  subagent_type?: string // Agent
  // Catch-all for other tools
  [key: string]: unknown
}

export interface ToolResult {
  content: string // truncated to 2000 chars
  truncated: boolean
  isError: boolean
}

export interface SubagentSession {
  agentId: string
  model: string | null
  turns: ConversationTurn[]
  toolCallCount: number
  toolBreakdown: Record<string, number>
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

// === Tacit Knowledge ===
export interface TacitKnowledge {
  workflowPatterns: WorkflowPattern[]
  commonToolSequences: ToolSequence[]
  painPoints: PainPoint[]
}

export interface WorkflowPattern {
  description: string // e.g. "Android bug fixes always use plan mode"
  evidence: string // supporting data
  sessionIds: string[]
}

export interface ToolSequence {
  sequence: string[] // e.g. ["Grep", "Read", "Edit"]
  count: number
  contexts: string[] // which projects/tasks
}

export interface PainPoint {
  type: 'long-session' | 'repeated-edits' | 'many-retries'
  description: string
  sessionId: string
  metric: number // duration in minutes, edit count, etc.
}
