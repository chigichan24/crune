import { describe, it, expect } from 'vitest'
import { enrichResults, formatScore } from '../searchResults'
import type { RetrievedChunk, SessionSummary } from '../../../types'

function makeSession(id: string, project: string): SessionSummary {
  return {
    sessionId: id,
    project,
    cwd: '/repo',
    gitBranch: null,
    slug: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastActiveAt: '2026-01-01T00:00:00Z',
    durationMinutes: 1,
    turnCount: 1,
    toolBreakdown: {},
    firstUserPrompt: 'hi',
    permissionMode: null,
    subagentCount: 0,
  }
}

const CHUNKS: RetrievedChunk[] = [
  { sessionId: 'aaaaaaaa-1111', turnIndex: 2, snippet: 'auth flow', score: 0.91 },
  { sessionId: 'missing-9999', turnIndex: 0, snippet: 'orphan', score: 0.2 },
]

describe('enrichResults', () => {
  it('joins a chunk to its session and uses the project as the context label', () => {
    const out = enrichResults(CHUNKS, [makeSession('aaaaaaaa-1111', 'crune')])
    expect(out[0].session?.project).toBe('crune')
    expect(out[0].contextLabel).toBe('crune')
  })

  it('falls back to a truncated sessionId when the session is not in the index', () => {
    const out = enrichResults(CHUNKS, [makeSession('aaaaaaaa-1111', 'crune')])
    expect(out[1].session).toBeNull()
    expect(out[1].contextLabel).toBe('missing-') // first 8 chars
  })

  it('preserves the order of results', () => {
    const out = enrichResults(CHUNKS, [])
    expect(out.map((r) => r.chunk.turnIndex)).toEqual([2, 0])
  })
})

describe('formatScore', () => {
  it('renders a 0..1 score as a clamped percentage', () => {
    expect(formatScore(0.873)).toBe('87%')
    expect(formatScore(0)).toBe('0%')
    expect(formatScore(1.5)).toBe('100%')
    expect(formatScore(-0.2)).toBe('0%')
  })
})
