/**
 * Pure helpers for ToolCallBlock rendering.
 *
 * These functions are split out from the React component so they can be tested
 * without a DOM/JSX runtime.
 */

import type { ConversationTurn } from '../../types'

export type ToolCategory =
  | 'shell'
  | 'edit'
  | 'read'
  | 'search'
  | 'agent'
  | 'task'
  | 'question'
  | 'skill'
  | 'web'
  | 'plan'
  | 'notebook'
  | 'mcp'
  | 'other'

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  // shell / file edits / reads / search / agent (existing)
  Bash: 'shell',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  Agent: 'agent',
  Task: 'agent',
  // task tracking
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TaskList: 'task',
  TaskGet: 'task',
  TaskOutput: 'task',
  TaskStop: 'task',
  TodoWrite: 'task',
  // questions / skills / search
  AskUserQuestion: 'question',
  Skill: 'skill',
  ToolSearch: 'search',
  // web
  WebFetch: 'web',
  WebSearch: 'web',
  // plan mode
  EnterPlanMode: 'plan',
  ExitPlanMode: 'plan',
  EnterWorktree: 'plan',
  ExitWorktree: 'plan',
  // notebook
  NotebookEdit: 'notebook',
  // misc
  ScheduleWakeup: 'other',
  Monitor: 'other',
  PushNotification: 'other',
  RemoteTrigger: 'other',
  LSP: 'other',
}

export function getToolCategory(name: string): ToolCategory {
  if (CATEGORY_BY_TOOL[name]) return CATEGORY_BY_TOOL[name]
  if (name.startsWith('mcp__')) return 'mcp'
  return 'other'
}

/**
 * Parse an MCP tool name into server / method parts.
 * Format: `mcp__<server>__<method>` (server may itself contain underscores).
 */
export interface McpToolParts {
  server: string
  method: string
}

export function parseMcpToolName(name: string): McpToolParts | null {
  if (!name.startsWith('mcp__')) return null
  // Strip the `mcp__` prefix, then split server/method on the FIRST `__`.
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep === -1) {
    return { server: rest, method: '' }
  }
  return {
    server: rest.slice(0, sep),
    method: rest.slice(sep + 2),
  }
}

/**
 * Count the number of lines in a string.
 *
 * An empty string has 0 lines. A trailing newline does not add a phantom
 * empty line (so `"a\nb\n"` is 2 lines, not 3). CRLF endings are normalized.
 */
export function countLines(str: string): number {
  if (str.length === 0) return 0
  const normalized = str.replace(/\r\n/g, '\n')
  const withoutTrailing = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized
  if (withoutTrailing.length === 0) return 1
  return withoutTrailing.split('\n').length
}

/** Thresholds for collapsing long tool input/output content. */
export const COLLAPSE_LINE_THRESHOLD = 15
export const COLLAPSE_CHAR_THRESHOLD = 500

/**
 * Decide whether a block of tool input/output text is large enough to be
 * collapsed by default. Collapses when it exceeds either the line OR the
 * character threshold.
 */
export function shouldCollapse(str: string): boolean {
  if (!str) return false
  return (
    countLines(str) > COLLAPSE_LINE_THRESHOLD ||
    str.length > COLLAPSE_CHAR_THRESHOLD
  )
}

/**
 * Truncate a string to a max length, adding an ellipsis when truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

/**
 * Render an arbitrary value as a short, human-readable summary string.
 * Used by the generic / unknown-tool fallback to keep things compact.
 */
export function summarizeValue(value: unknown, maxLen = 120): string {
  if (value == null) return ''
  if (typeof value === 'string') return truncate(value, maxLen)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.length} item${value.length === 1 ? '' : 's'}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return `{${keys.length} key${keys.length === 1 ? '' : 's'}}`
  }
  return truncate(String(value), maxLen)
}

/**
 * Pick a small set of "key" arguments from a tool input for the fallback view.
 *
 * Heuristic: prefer well-known argument names that identify what the call is
 * doing (`url`, `file_path`, `command`, `query`, etc.) before falling back to
 * the first scalar fields.
 */
const PRIORITY_KEYS = [
  'url',
  'file_path',
  'path',
  'command',
  'query',
  'pattern',
  'prompt',
  'description',
  'subject',
  'taskId',
  'status',
  'name',
  'title',
  'message',
  'subagent_type',
]

export interface KeyArg {
  key: string
  value: unknown
  display: string
}

export function pickKeyInputArgs(
  input: Record<string, unknown>,
  limit = 2,
): KeyArg[] {
  if (!input) return []
  const seen = new Set<string>()
  const result: KeyArg[] = []

  // 1) priority keys, in order
  for (const key of PRIORITY_KEYS) {
    if (result.length >= limit) break
    if (key in input && input[key] != null) {
      seen.add(key)
      result.push({ key, value: input[key], display: summarizeValue(input[key]) })
    }
  }

  // 2) any remaining scalar fields
  if (result.length < limit) {
    for (const [key, value] of Object.entries(input)) {
      if (result.length >= limit) break
      if (seen.has(key)) continue
      if (value == null) continue
      const t = typeof value
      if (t !== 'string' && t !== 'number' && t !== 'boolean') continue
      result.push({ key, value, display: summarizeValue(value) })
    }
  }

  return result
}

/**
 * Kind of a semantic "key moment" in a session, used to label jump links.
 */
export type KeyMomentKind = 'plan' | 'agent' | 'prompt' | 'final'

export interface KeyMoment {
  /** Index into the turns array (matches ConversationTurn position). */
  index: number
  kind: KeyMomentKind
  /** Short Japanese label for the jump link. */
  label: string
}

/** A user prompt this long (chars) counts as substantive. */
export const KEY_MOMENT_PROMPT_MIN_CHARS = 80

const PLAN_TASK_TOOLS = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'TaskCreate',
  'TaskUpdate',
])

const KEY_MOMENT_LABELS: Record<KeyMomentKind, string> = {
  plan: '計画',
  agent: 'エージェント',
  prompt: 'プロンプト',
  final: '最終',
}

/** Resolution order when several key-moment kinds apply to the same turn. */
const KIND_PRIORITY: Record<KeyMomentKind, number> = {
  agent: 3,
  plan: 2,
  prompt: 1,
  final: 0,
}

/**
 * Select the semantic "key moments" of a session for the jump-link rail.
 *
 * Key moments are:
 *  - plan/task turns (Enter/ExitPlanMode, TaskCreate/Update)
 *  - agent turns (spawning subagents)
 *  - the final turn
 *  - user prompts only when long/substantive (>= KEY_MOMENT_PROMPT_MIN_CHARS)
 *
 * Each turn yields at most one moment; when several signals apply, the
 * highest-priority kind wins (agent > plan > prompt > final). The result is
 * sorted ascending by index with no duplicate indices.
 */
export function selectKeyMoments(turns: ConversationTurn[]): KeyMoment[] {
  if (turns.length === 0) return []
  const lastIndex = turns.length - 1
  const byIndex = new Map<number, KeyMomentKind>()

  const setKind = (index: number, kind: KeyMomentKind) => {
    const existing = byIndex.get(index)
    if (existing == null || KIND_PRIORITY[kind] > KIND_PRIORITY[existing]) {
      byIndex.set(index, kind)
    }
  }

  turns.forEach((turn, index) => {
    const toolCalls = turn.toolCalls ?? []
    const hasAgent = toolCalls.some(
      tc => tc.toolName === 'Agent' || tc.toolName === 'Task',
    )
    const hasPlan = toolCalls.some(tc => PLAN_TASK_TOOLS.has(tc.toolName ?? ''))
    const promptLen = (turn.userPrompt ?? '').trim().length

    if (hasAgent) setKind(index, 'agent')
    if (hasPlan) setKind(index, 'plan')
    if (promptLen >= KEY_MOMENT_PROMPT_MIN_CHARS) {
      setKind(index, 'prompt')
    }
  })

  // Final turn is always a key moment (lowest priority, won't override others).
  setKind(lastIndex, 'final')

  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, kind]) => ({ index, kind, label: KEY_MOMENT_LABELS[kind] }))
}

/**
 * Active filter state for the playback search/filter bar.
 */
export interface PlaybackFilter {
  /** Free-text query (matched against prompt, assistant texts, tool names). */
  text: string
  /** Exact tool-name filter ('' = any). */
  toolName: string
  /** When true, only key-moment turns match. */
  keyTurnsOnly: boolean
}

/**
 * Pure predicate: does a turn satisfy the active filter?
 *
 * AND semantics across the active conditions. Free-text matches the user
 * prompt, assistant texts, and tool names (case-insensitive). The tool-name
 * filter requires an exact tool match. `keyTurnsOnly` restricts to indices in
 * `keyIndices`. An empty/whitespace-only condition is treated as inactive.
 */
export function turnMatchesFilter(
  turn: ConversationTurn,
  index: number,
  filter: PlaybackFilter,
  keyIndices: Set<number>,
): boolean {
  if (filter.keyTurnsOnly && !keyIndices.has(index)) return false

  const toolNames = (turn.toolCalls ?? []).map(tc => tc.toolName ?? '')

  if (filter.toolName && !toolNames.includes(filter.toolName)) return false

  const query = filter.text.trim().toLowerCase()
  if (query) {
    const haystack = [
      turn.userPrompt ?? '',
      ...(turn.assistantTexts ?? []),
      ...toolNames,
    ]
      .join('\n')
      .toLowerCase()
    if (!haystack.includes(query)) return false
  }

  return true
}
