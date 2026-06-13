/**
 * Pure helpers for ToolCallBlock rendering.
 *
 * These functions are split out from the React component so they can be tested
 * without a DOM/JSX runtime.
 */

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
