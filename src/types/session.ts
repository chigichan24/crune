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
  projectDir: string // raw dir name e.g. "-Users-kazuki-chigita-src-github-com-..."
  displayName: string // e.g. "chigichan24/crune"
  sessionCount: number
  totalDurationMinutes: number
}

export interface SessionSummary {
  sessionId: string
  project: string // displayName
  projectDir: string
  slug: string | null
  cwd: string
  gitBranch: string | null
  version: string | null
  createdAt: string // ISO8601
  lastActiveAt: string // ISO8601
  durationMinutes: number
  turnCount: number
  toolCallCount: number
  toolBreakdown: Record<string, number>
  modelsUsed: Record<string, number>
  filesEdited: string[]
  subagentCount: number
  firstUserPrompt: string // truncated to 200 chars
  hasPlan: boolean
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
  statistics: OverviewStatistics
  knowledgeGraph: KnowledgeGraph
  tacitKnowledge: TacitKnowledge
}

export interface OverviewStatistics {
  activityHeatmap: number[][] // [7][24] dayOfWeek x hour
  projectDistribution: ProjectDistItem[]
  weeklyToolTrends: WeeklyToolTrend[]
  durationDistribution: DurationBucket[]
  topFiles: TopFile[]
  modelUsage: ModelUsageItem[]
}

export interface ProjectDistItem {
  project: string
  sessionCount: number
  totalDurationMinutes: number
}

export interface WeeklyToolTrend {
  weekLabel: string // e.g. "2025-W01"
  tools: Record<string, number>
}

export interface DurationBucket {
  rangeLabel: string // e.g. "0-5min", "5-15min"
  count: number
}

export interface TopFile {
  filePath: string
  editCount: number
  projects: string[] // which projects edited this file
}

export interface ModelUsageItem {
  model: string
  count: number
}

// === Knowledge Graph ===
export interface KnowledgeGraph {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  clusters: KnowledgeCluster[]
}

export interface KnowledgeNode {
  id: string // sessionId
  project: string
  firstPrompt: string // truncated to 30 chars for label
  createdAt: string
  toolCallCount: number
  durationMinutes: number
}

export interface KnowledgeEdge {
  source: string // sessionId
  target: string // sessionId
  type: EdgeType
  strength: number // 0-1
}

export type EdgeType =
  | 'same-branch'
  | 'shared-files'
  | 'resume-chain'
  | 'memory-chain'
  | 'plan-reference'

export interface KnowledgeCluster {
  id: string
  nodeIds: string[]
  label: string // auto-generated from dominant project/branch
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
