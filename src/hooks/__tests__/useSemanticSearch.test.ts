import { describe, it, expect, vi } from 'vitest'
import { mapRetrieveResponse, runSearchRequest } from '../useSemanticSearch'
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

  it('uses a status-specific fallback when the body carries no error', () => {
    const notReady = mapRetrieveResponse(false, {}, 503)
    const unsupported = mapRetrieveResponse(false, {}, 404)
    const generic = mapRetrieveResponse(false, {}, 500)
    // 503 (model warming) and 404 (no endpoint) must be distinguishable, not
    // collapsed into one generic message.
    expect(notReady.error).toMatch(/モデル準備中/)
    expect(unsupported.error).toMatch(/検索に対応/)
    expect(generic.error).not.toBe(notReady.error)
    expect(generic.error).not.toBe(unsupported.error)
  })

  it('prefers the server-provided error over the status fallback', () => {
    const out = mapRetrieveResponse(false, { error: 'index unreadable' }, 503)
    expect(out.error).toBe('index unreadable')
  })
})

/** Build a mock Response good enough for `runSearchRequest`. */
function okResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response
}

describe('runSearchRequest stale-response guard', () => {
  it('applies the response when its seq is still current', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ results: HITS }))
    const next = await runSearchRequest(
      'auth flow',
      1,
      () => 1, // seq unchanged → response is current
      new AbortController().signal,
      fetchImpl as unknown as typeof fetch,
    )
    expect(next).toEqual({ results: HITS, loading: false, error: null })
  })

  it('drops a resolved response once the query was cleared (seq bumped)', async () => {
    // Repro for the stale-clobber bug: a long query fires (seq=1), then the
    // input is cleared below MIN_QUERY_LENGTH which bumps the seq to 2 BEFORE
    // the in-flight fetch resolves. The resolved results must NOT clobber the
    // cleared empty state.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ results: HITS }))
    const next = await runSearchRequest(
      'auth flow',
      1,
      () => 2, // clear path bumped requestSeq past this request
      new AbortController().signal,
      fetchImpl as unknown as typeof fetch,
    )
    expect(next).toBeNull()
  })

  it('drops an errored response that has been superseded', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'))
    const next = await runSearchRequest(
      'auth flow',
      1,
      () => 2,
      new AbortController().signal,
      fetchImpl as unknown as typeof fetch,
    )
    expect(next).toBeNull()
  })
})
