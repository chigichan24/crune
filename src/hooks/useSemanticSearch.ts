import { useState, useEffect, useRef } from 'react'
import type { RetrievedChunk } from '../types'

export interface SemanticSearchState {
  results: RetrievedChunk[]
  loading: boolean
  /** Human-readable error (Japanese), or null. Best-effort: degrades gracefully. */
  error: string | null
}

/** Debounce delay before a non-empty query hits the server, in ms. */
export const SEARCH_DEBOUNCE_MS = 350
/** Minimum query length before a search fires (shorter queries are no-ops). */
export const MIN_QUERY_LENGTH = 2

interface RetrieveResponse {
  results?: RetrievedChunk[]
  error?: string
}

/**
 * Map a `/api/retrieve` HTTP outcome onto the hook state. Extracted as a pure
 * function so it can be unit tested without React or a real fetch.
 *
 * - non-OK responses surface the server's `error` field (e.g. the "run --embed"
 *   hint) so the UI can tell the user how to fix it;
 * - OK responses return the results array (or empty).
 */
export function mapRetrieveResponse(
  ok: boolean,
  body: RetrieveResponse,
): { results: RetrievedChunk[]; error: string | null } {
  if (!ok) {
    return { results: [], error: body.error ?? '検索サーバーでエラーが発生しました' }
  }
  return { results: body.results ?? [], error: null }
}

/**
 * Run one `/api/retrieve` request and resolve to the next hook state, or `null`
 * if the response is stale (a newer request — or a query-clear — has bumped the
 * sequence past `seq`) and must be dropped.
 *
 * Extracted as a pure function so the out-of-order / stale-clobber guard can be
 * unit tested with a mock fetch and no DOM: the `getCurrentSeq` callback models
 * the `requestSeq` ref, and returning `null` proves a resolved-then-superseded
 * response leaves the (already cleared) state untouched.
 */
export async function runSearchRequest(
  query: string,
  seq: number,
  getCurrentSeq: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SemanticSearchState | null> {
  try {
    const res = await fetchImpl('/api/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    })
    const body: RetrieveResponse = await res.json().catch(() => ({}))
    if (seq !== getCurrentSeq()) return null
    const { results, error } = mapRetrieveResponse(res.ok, body)
    return { results, loading: false, error }
  } catch (e) {
    if (signal.aborted || seq !== getCurrentSeq()) return null
    const message =
      e instanceof TypeError
        ? '検索サーバーに接続できません（npm run skill-server で起動してください）'
        : e instanceof Error
          ? e.message
          : '不明なエラー'
    return { results: [], loading: false, error: message }
  }
}

/**
 * Debounced semantic search over the chunk embedding index via the local skill
 * server (`POST /api/retrieve`, proxied by Vite). Best-effort: when the server
 * is down or the index is missing, it sets a friendly Japanese error and an
 * empty result set rather than throwing.
 *
 * Static-deploy note: this PoC routes retrieval through the local server. An
 * in-browser path (loading the ~93KB quantized index + a WASM embedder) is a
 * viable follow-up since the index stays small; it is intentionally out of
 * scope here.
 */
export function useSemanticSearch(query: string): SemanticSearchState {
  const [state, setState] = useState<SemanticSearchState>({
    results: [],
    loading: false,
    error: null,
  })
  // Guards against out-of-order responses clobbering newer ones.
  const requestSeq = useRef(0)

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      // Bump the seq on the early-clear path too, so the single-seq invariant
      // holds on EVERY path. Otherwise an in-flight response that resolves just
      // before this clear could still pass `seq === requestSeq.current` and
      // clobber the cleared empty state with stale results (the AbortController
      // only covers the still-pending case, not one that already resolved).
      requestSeq.current++
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query falls below threshold is intentional
      setState({ results: [], loading: false, error: null })
      return
    }

    const seq = ++requestSeq.current
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    const timer = setTimeout(async () => {
      const next = await runSearchRequest(
        trimmed,
        seq,
        () => requestSeq.current,
        controller.signal,
      )
      if (next) setState(next)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  return state
}
