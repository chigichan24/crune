import { useSemanticSearch } from '../../../hooks/useSemanticSearch'
import { formatScore } from '../../search/searchResults'
import './SimilarMoments.css'

interface Props {
  /** Text of the bookmarked turn, used as the semantic-search query. */
  queryText: string
  /** Session this bookmark belongs to, so we can drop self-matches. */
  currentSessionId: string
  /** Turn this bookmark belongs to, so we can drop the exact self-match. */
  currentTurnIndex: number
  /** Open the playback drawer at a similar moment. */
  onSelect: (sessionId: string, turnIndex: number) => void
}

/**
 * "このブックマークに似た瞬間" — runs a semantic search using the bookmarked
 * turn's text and lists similar moments across sessions. The retriever already
 * caps results per session, giving cluster-aware diversification for free.
 *
 * Best-effort: when the local skill server / index is unavailable the hook
 * surfaces a friendly message and this panel shows it instead of results.
 */
export function SimilarMoments({
  queryText,
  currentSessionId,
  currentTurnIndex,
  onSelect,
}: Props) {
  const { results, loading, error } = useSemanticSearch(queryText)

  // Drop the bookmark itself from its own similarity list.
  const others = results.filter(
    (r) => !(r.sessionId === currentSessionId && r.turnIndex === currentTurnIndex),
  )

  return (
    <div className="similar-moments">
      <div className="similar-moments-title">このブックマークに似た瞬間</div>
      {loading && <div className="similar-moments-status">検索中...</div>}
      {!loading && error && (
        <div className="similar-moments-status similar-moments-status--error">{error}</div>
      )}
      {!loading && !error && others.length === 0 && (
        <div className="similar-moments-status">似た瞬間は見つかりませんでした</div>
      )}
      {!loading && !error && others.length > 0 && (
        <ul className="similar-moments-list">
          {others.map((r) => (
            <li key={`${r.sessionId}-${r.turnIndex}`}>
              <button
                className="similar-moments-item"
                onClick={() => onSelect(r.sessionId, r.turnIndex)}
              >
                <div className="similar-moments-item-head">
                  <span className="similar-moments-item-ctx">
                    {r.sessionId.slice(0, 8)} #{r.turnIndex + 1}
                  </span>
                  <span className="similar-moments-item-score">{formatScore(r.score)}</span>
                </div>
                <div className="similar-moments-item-snippet">{r.snippet}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
