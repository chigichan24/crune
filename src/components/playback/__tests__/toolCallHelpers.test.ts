import { describe, it, expect } from 'vitest'
import type { ConversationTurn } from '../../../types'
import {
  countLines,
  getToolCategory,
  parseMcpToolName,
  pickKeyInputArgs,
  selectKeyMoments,
  shouldCollapse,
  summarizeValue,
  truncate,
  turnMatchesFilter,
} from '../toolCallHelpers'
import type { PlaybackFilter } from '../toolCallHelpers'

function makeTurn(partial: Partial<ConversationTurn> & { turnIndex: number }): ConversationTurn {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    userPrompt: '',
    assistantThinking: [],
    assistantTexts: [],
    toolCalls: [],
    ...partial,
  }
}

describe('countLines', () => {
  it('returns 0 for an empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('counts a single line with no trailing newline', () => {
    expect(countLines('hello')).toBe(1)
  })

  it('counts lines separated by \\n', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('does not count a trailing newline as an extra empty line', () => {
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('handles CRLF line endings', () => {
    expect(countLines('a\r\nb\r\nc')).toBe(3)
  })

  it('counts blank interior lines', () => {
    expect(countLines('a\n\nb')).toBe(3)
  })
})

describe('shouldCollapse', () => {
  it('does not collapse short single-line content', () => {
    expect(shouldCollapse('hello world')).toBe(false)
  })

  it('collapses content with more than 15 lines', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `line ${i}`).join('\n')
    expect(shouldCollapse(sixteen)).toBe(true)
  })

  it('does not collapse content with exactly 15 lines under the char limit', () => {
    const fifteen = Array.from({ length: 15 }, () => 'x').join('\n')
    expect(shouldCollapse(fifteen)).toBe(false)
  })

  it('collapses content longer than 500 chars even on a single line', () => {
    expect(shouldCollapse('a'.repeat(501))).toBe(true)
  })

  it('does not collapse content of exactly 500 chars on few lines', () => {
    expect(shouldCollapse('a'.repeat(500))).toBe(false)
  })
})

describe('selectKeyMoments', () => {
  it('returns empty for no turns', () => {
    expect(selectKeyMoments([])).toEqual([])
  })

  it('always includes the final turn', () => {
    const turns = [
      makeTurn({ turnIndex: 0, userPrompt: 'hi' }),
      makeTurn({ turnIndex: 1, userPrompt: 'bye' }),
    ]
    const moments = selectKeyMoments(turns)
    expect(moments.some(m => m.index === 1)).toBe(true)
    expect(moments[moments.length - 1].kind).toBe('final')
  })

  it('flags agent turns', () => {
    const turns = [
      makeTurn({ turnIndex: 0, toolCalls: [{ toolUseId: 't', toolName: 'Agent', input: {} }] }),
      makeTurn({ turnIndex: 1 }),
    ]
    const moments = selectKeyMoments(turns)
    const m = moments.find(x => x.index === 0)
    expect(m?.kind).toBe('agent')
  })

  it('flags plan/task turns', () => {
    const turns = [
      makeTurn({ turnIndex: 0, toolCalls: [{ toolUseId: 't', toolName: 'EnterPlanMode', input: {} }] }),
      makeTurn({ turnIndex: 1, toolCalls: [{ toolUseId: 't', toolName: 'TaskCreate', input: {} }] }),
      makeTurn({ turnIndex: 2 }),
    ]
    const moments = selectKeyMoments(turns)
    expect(moments.find(x => x.index === 0)?.kind).toBe('plan')
    expect(moments.find(x => x.index === 1)?.kind).toBe('plan')
  })

  it('includes long/substantive user prompts but not short ones', () => {
    const longPrompt = 'a'.repeat(100)
    const turns = [
      makeTurn({ turnIndex: 0, userPrompt: 'short' }),
      makeTurn({ turnIndex: 1, userPrompt: longPrompt }),
      makeTurn({ turnIndex: 2 }),
    ]
    const moments = selectKeyMoments(turns)
    expect(moments.some(m => m.index === 0)).toBe(false)
    expect(moments.find(m => m.index === 1)?.kind).toBe('prompt')
  })

  it('returns moments sorted by index without duplicates', () => {
    const turns = [
      makeTurn({ turnIndex: 0, toolCalls: [{ toolUseId: 't', toolName: 'Agent', input: {} }], userPrompt: 'x'.repeat(100) }),
      makeTurn({ turnIndex: 1 }),
    ]
    const moments = selectKeyMoments(turns)
    const indices = moments.map(m => m.index)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(new Set(indices).size).toBe(indices.length)
  })
})

describe('turnMatchesFilter', () => {
  const empty: PlaybackFilter = { text: '', toolName: '', keyTurnsOnly: false }
  const keyIndices = new Set([2])

  it('matches everything when the filter is empty', () => {
    const turn = makeTurn({ turnIndex: 0, userPrompt: 'anything' })
    expect(turnMatchesFilter(turn, 0, empty, keyIndices)).toBe(true)
  })

  it('matches free text against the user prompt (case-insensitive)', () => {
    const turn = makeTurn({ turnIndex: 0, userPrompt: 'Fix the BUG in parser' })
    expect(turnMatchesFilter(turn, 0, { ...empty, text: 'bug' }, keyIndices)).toBe(true)
    expect(turnMatchesFilter(turn, 0, { ...empty, text: 'feature' }, keyIndices)).toBe(false)
  })

  it('matches free text against assistant texts', () => {
    const turn = makeTurn({ turnIndex: 0, assistantTexts: ['Here is the diff'] })
    expect(turnMatchesFilter(turn, 0, { ...empty, text: 'diff' }, keyIndices)).toBe(true)
  })

  it('matches free text against tool names', () => {
    const turn = makeTurn({
      turnIndex: 0,
      toolCalls: [{ toolUseId: 't', toolName: 'Bash', input: {} }],
    })
    expect(turnMatchesFilter(turn, 0, { ...empty, text: 'bash' }, keyIndices)).toBe(true)
  })

  it('filters by exact tool name', () => {
    const turn = makeTurn({
      turnIndex: 0,
      toolCalls: [{ toolUseId: 't', toolName: 'Edit', input: {} }],
    })
    expect(turnMatchesFilter(turn, 0, { ...empty, toolName: 'Edit' }, keyIndices)).toBe(true)
    expect(turnMatchesFilter(turn, 0, { ...empty, toolName: 'Bash' }, keyIndices)).toBe(false)
  })

  it('restricts to key turns when keyTurnsOnly is set', () => {
    const turn = makeTurn({ turnIndex: 2 })
    expect(turnMatchesFilter(turn, 2, { ...empty, keyTurnsOnly: true }, keyIndices)).toBe(true)
    expect(turnMatchesFilter(turn, 1, { ...empty, keyTurnsOnly: true }, keyIndices)).toBe(false)
  })

  it('requires all active conditions (AND semantics)', () => {
    const turn = makeTurn({
      turnIndex: 2,
      userPrompt: 'fix bug',
      toolCalls: [{ toolUseId: 't', toolName: 'Edit', input: {} }],
    })
    const filter: PlaybackFilter = { text: 'bug', toolName: 'Edit', keyTurnsOnly: true }
    expect(turnMatchesFilter(turn, 2, filter, keyIndices)).toBe(true)
    // text fails
    expect(turnMatchesFilter(turn, 2, { ...filter, text: 'nope' }, keyIndices)).toBe(false)
    // tool fails
    expect(turnMatchesFilter(turn, 2, { ...filter, toolName: 'Bash' }, keyIndices)).toBe(false)
  })

  it('ignores whitespace-only text filters', () => {
    const turn = makeTurn({ turnIndex: 0, userPrompt: 'hi' })
    expect(turnMatchesFilter(turn, 0, { ...empty, text: '   ' }, keyIndices)).toBe(true)
  })
})

describe('getToolCategory', () => {
  it('classifies the existing 7 tool surface', () => {
    expect(getToolCategory('Bash')).toBe('shell')
    expect(getToolCategory('Edit')).toBe('edit')
    expect(getToolCategory('Write')).toBe('edit')
    expect(getToolCategory('Read')).toBe('read')
    expect(getToolCategory('Grep')).toBe('search')
    expect(getToolCategory('Glob')).toBe('search')
    expect(getToolCategory('Agent')).toBe('agent')
  })

  it('classifies the new high-priority tools', () => {
    expect(getToolCategory('TaskCreate')).toBe('task')
    expect(getToolCategory('TaskUpdate')).toBe('task')
    expect(getToolCategory('AskUserQuestion')).toBe('question')
    expect(getToolCategory('Skill')).toBe('skill')
    expect(getToolCategory('WebFetch')).toBe('web')
    expect(getToolCategory('WebSearch')).toBe('web')
    expect(getToolCategory('NotebookEdit')).toBe('notebook')
  })

  it('classifies plan-mode toggles', () => {
    expect(getToolCategory('EnterPlanMode')).toBe('plan')
    expect(getToolCategory('ExitPlanMode')).toBe('plan')
    expect(getToolCategory('EnterWorktree')).toBe('plan')
    expect(getToolCategory('ExitWorktree')).toBe('plan')
  })

  it('classifies any mcp__* tool as mcp regardless of server', () => {
    expect(getToolCategory('mcp__XcodeBuildMCP__list_sims')).toBe('mcp')
    expect(getToolCategory('mcp__mobile-mcp__mobile_take_screenshot')).toBe('mcp')
  })

  it('falls back to other for unknown tool names', () => {
    expect(getToolCategory('SomethingNew')).toBe('other')
    expect(getToolCategory('')).toBe('other')
  })
})

describe('parseMcpToolName', () => {
  it('returns null for non-mcp tools', () => {
    expect(parseMcpToolName('Bash')).toBeNull()
    expect(parseMcpToolName('TaskCreate')).toBeNull()
  })

  it('splits server and method on the first __', () => {
    expect(parseMcpToolName('mcp__XcodeBuildMCP__list_sims')).toEqual({
      server: 'XcodeBuildMCP',
      method: 'list_sims',
    })
  })

  it('handles servers with hyphens and methods with underscores', () => {
    expect(parseMcpToolName('mcp__mobile-mcp__mobile_take_screenshot')).toEqual({
      server: 'mobile-mcp',
      method: 'mobile_take_screenshot',
    })
  })

  it('handles names without a method segment', () => {
    expect(parseMcpToolName('mcp__solo')).toEqual({
      server: 'solo',
      method: '',
    })
  })
})

describe('truncate', () => {
  it('returns the input unchanged when within the limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('appends an ellipsis when truncating', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde...')
  })
})

describe('summarizeValue', () => {
  it('summarizes scalars verbatim', () => {
    expect(summarizeValue('hi')).toBe('hi')
    expect(summarizeValue(42)).toBe('42')
    expect(summarizeValue(true)).toBe('true')
  })

  it('renders arrays and objects compactly', () => {
    expect(summarizeValue([1, 2, 3])).toBe('[3 items]')
    expect(summarizeValue([])).toBe('[0 items]')
    expect(summarizeValue([1])).toBe('[1 item]')
    expect(summarizeValue({ a: 1, b: 2 })).toBe('{2 keys}')
    expect(summarizeValue({ a: 1 })).toBe('{1 key}')
  })

  it('truncates long strings', () => {
    expect(summarizeValue('a'.repeat(200), 10)).toBe('aaaaaaaaaa...')
  })

  it('returns empty string for null/undefined', () => {
    expect(summarizeValue(null)).toBe('')
    expect(summarizeValue(undefined)).toBe('')
  })
})

describe('pickKeyInputArgs', () => {
  it('prefers high-signal keys in priority order', () => {
    const args = pickKeyInputArgs({
      verbose: true,
      command: 'npm run build',
      url: 'https://example.com',
      misc: 'whatever',
    })
    // url > command in priority list
    expect(args.map(a => a.key)).toEqual(['url', 'command'])
  })

  it('falls back to scalar fields when no priority keys match', () => {
    const args = pickKeyInputArgs({
      foo: 'one',
      bar: 'two',
      baz: { nested: true },
    })
    expect(args.map(a => a.key)).toEqual(['foo', 'bar'])
  })

  it('skips null and complex values when filling from non-priority keys', () => {
    const args = pickKeyInputArgs({
      maybe: null,
      nested: { x: 1 },
      list: [1, 2],
      hello: 'world',
    })
    expect(args.map(a => a.key)).toEqual(['hello'])
  })

  it('respects the limit', () => {
    const args = pickKeyInputArgs(
      { url: 'u', file_path: '/a', command: 'c', query: 'q' },
      2,
    )
    expect(args).toHaveLength(2)
  })

  it('returns empty list for empty input', () => {
    expect(pickKeyInputArgs({})).toEqual([])
  })
})
