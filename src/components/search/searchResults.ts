import type { RetrievedChunk, SessionSummary } from '../../types'

/** A retrieved chunk joined with its owning session's display metadata. */
export interface EnrichedResult {
  chunk: RetrievedChunk
  /** The owning session, when present in the loaded index. */
  session: SessionSummary | null
  /** `project` (or sessionId prefix fallback) for a compact context label. */
  contextLabel: string
}

/** Score formatted as a percentage string (e.g. `0.873` -> `"87%"`). */
export function formatScore(score: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return `${pct}%`
}

/**
 * Join retrieved chunks to their session summaries for display. Pure so the
 * mapping (and the missing-session fallback) can be unit tested without React.
 * Results whose session is not in the index still render — they just fall back
 * to a truncated sessionId label so a stale index never hides a hit.
 */
export function enrichResults(
  results: RetrievedChunk[],
  sessions: SessionSummary[],
): EnrichedResult[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]))
  return results.map((chunk) => {
    const session = byId.get(chunk.sessionId) ?? null
    const contextLabel = session?.project ?? chunk.sessionId.slice(0, 8)
    return { chunk, session, contextLabel }
  })
}
