import { describe, it, expect } from 'vitest'
import { mapRetrieveResponse } from '../useSemanticSearch'
import type { RetrievedChunk } from '../../types'

const HITS: RetrievedChunk[] = [
  { sessionId: 's1', turnIndex: 3, snippet: 'fix auth', score: 0.8 },
]

describe('mapRetrieveResponse', () => {
  it('returns results on an OK response', () => {
    expect(mapRetrieveResponse(true, { results: HITS })).toEqual({
      results: HITS,
      error: null,
    })
  })

  it('treats a missing results array as empty (no error)', () => {
    expect(mapRetrieveResponse(true, {})).toEqual({ results: [], error: null })
  })

  it('surfaces the server error on a non-OK response', () => {
    const out = mapRetrieveResponse(false, {
      error: 'no embedding index; run analyze-sessions --embed',
    })
    expect(out.results).toEqual([])
    expect(out.error).toBe('no embedding index; run analyze-sessions --embed')
  })

  it('falls back to a generic message when a non-OK response has no error field', () => {
    const out = mapRetrieveResponse(false, {})
    expect(out.results).toEqual([])
    expect(out.error).not.toBeNull()
  })
})
