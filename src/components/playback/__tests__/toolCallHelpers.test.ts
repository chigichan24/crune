import { describe, it, expect } from 'vitest'
import {
  countLines,
  getToolCategory,
  parseMcpToolName,
  pickKeyInputArgs,
  shouldCollapse,
  summarizeValue,
  truncate,
} from '../toolCallHelpers'

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
