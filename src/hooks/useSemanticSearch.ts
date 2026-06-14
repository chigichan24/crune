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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query falls below threshold is intentional
      setState({ results: [], loading: false, error: null })
      return
    }

    const seq = ++requestSeq.current
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/retrieve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
          signal: controller.signal,
        })
        const body: RetrieveResponse = await res.json().catch(() => ({}))
        if (seq !== requestSeq.current) return
        const { results, error } = mapRetrieveResponse(res.ok, body)
        setState({ results, loading: false, error })
      } catch (e) {
        if (controller.signal.aborted || seq !== requestSeq.current) return
        const message =
          e instanceof TypeError
            ? '検索サーバーに接続できません（npm run skill-server で起動してください）'
            : e instanceof Error
              ? e.message
              : '不明なエラー'
        setState({ results: [], loading: false, error: message })
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  return state
}
