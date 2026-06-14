import { useState } from 'react'
import type { SessionSummary } from '../../types'
import { useSemanticSearch } from '../../hooks/useSemanticSearch'
import { enrichResults, formatScore } from './searchResults'
import './SemanticSearch.css'

interface Props {
  sessions: SessionSummary[]
  /** Open the playback drawer at the matched turn. */
  onResultSelect: (sessionId: string, turnIndex: number) => void
}

/**
 * Semantic search bar over the chunk embedding index. Renders matching turns as
 * a result list (snippet + session context + score); clicking a result opens
 * the playback drawer at that turn via `onResultSelect`.
 *
 * Best-effort: when the local skill server / index is unavailable, the hook
 * surfaces a friendly message and the bar simply shows it instead of results.
 */
export function SemanticSearch({ sessions, onResultSelect }: Props) {
  const [query, setQuery] = useState('')
  const { results, loading, error } = useSemanticSearch(query)
  const enriched = enrichResults(results, sessions)
  const showPanel = query.trim().length >= 2

  return (
    <div className="semantic-search">
      <div className="semantic-search-bar">
        <span className="semantic-search-icon" aria-hidden>🔍</span>
        <input
          type="text"
          className="semantic-search-input"
          placeholder="意味で検索（例: 認証フローのバグを直した瞬間）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="semantic-search-clear"
            onClick={() => setQuery('')}
            aria-label="検索をクリア"
          >
            ✕
          </button>
        )}
      </div>

      {showPanel && (
        <div className="semantic-search-panel">
          {loading && (
            <div className="semantic-search-status">検索中...</div>
          )}
          {!loading && error && (
            <div className="semantic-search-status semantic-search-status--error">
              {error}
            </div>
          )}
          {!loading && !error && enriched.length === 0 && (
            <div className="semantic-search-status">一致する瞬間が見つかりませんでした</div>
          )}
          {!loading && !error && enriched.length > 0 && (
            <ul className="semantic-search-results">
              {enriched.map(({ chunk, contextLabel }) => (
                <li key={`${chunk.sessionId}-${chunk.turnIndex}`}>
                  <button
                    className="semantic-search-result"
                    onClick={() => onResultSelect(chunk.sessionId, chunk.turnIndex)}
                  >
                    <div className="semantic-search-result-head">
                      <span className="semantic-search-result-context">{contextLabel}</span>
                      <span className="semantic-search-result-turn">#{chunk.turnIndex + 1}</span>
                      <span className="semantic-search-result-score">{formatScore(chunk.score)}</span>
                    </div>
                    <div className="semantic-search-result-snippet">{chunk.snippet}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
