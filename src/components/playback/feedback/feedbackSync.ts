/**
 * Best-effort bridge that mirrors a session's feedback to the local skill-server
 * so the offline pipeline can read it from `public/data/feedback.json`.
 *
 * localStorage remains the offline source of truth; this sync is purely additive
 * and MUST NOT block the UI or surface errors. Every failure (server down,
 * offline, CORS) is swallowed — the dashboard works without the server running.
 *
 * Mirrors the `/api/synthesize` client contract: a relative `/api/feedback` URL
 * proxied by Vite in dev to `localhost:3456`.
 */
import type { FeedbackEntry } from '../../../types'

const FEEDBACK_SYNC_URL = '/api/feedback'

/**
 * Fire-and-forget POST of one session's entries to the skill-server. Resolves
 * (never rejects) regardless of outcome so callers can ignore the result.
 * An empty `entries` array clears the session's bucket on disk.
 */
export function syncSessionFeedback(
  sessionId: string,
  entries: FeedbackEntry[],
): void {
  if (typeof fetch !== 'function') return
  try {
    void fetch(FEEDBACK_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, entries }),
      // Keep the request alive even if the user navigates away mid-flight.
      keepalive: true,
    }).catch(() => {
      // Offline / server not running — localStorage already has the truth.
    })
  } catch {
    // Synchronous throw (e.g. fetch unavailable) — ignore.
  }
}
