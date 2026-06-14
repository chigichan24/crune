import { useEffect, useRef, useState } from 'react'
import { useFeedback } from './FeedbackContext'
import { TagInput } from './TagInput'
import { SimilarMoments } from './SimilarMoments'
import './FeedbackCluster.css'

interface Props {
  turnId: number
  /** Tool-call block id (toolUseId) for block-level feedback; absent = turn-level. */
  blockId?: string
  /**
   * Context enabling the "似た瞬間" affordance on a bookmarked turn. Provided at
   * the turn level (omitted for block-level clusters), so the button only
   * appears where a meaningful query text + navigation target exist.
   */
  similar?: {
    /** Text of this turn, used as the semantic-search query. */
    queryText: string
    sessionId: string
    /** Open the playback drawer at a similar moment (sessionId, turnIndex). */
    onSelect: (sessionId: string, turnIndex: number) => void
  }
}

/**
 * Icon cluster for bookmark / tags / note feedback on a turn or tool-call
 * block. Reads and writes via FeedbackContext. Tags and note open inline
 * popovers using the expand/collapse convention (useState + conditional
 * render, no animation).
 */
export function FeedbackCluster({ turnId, blockId, similar }: Props) {
  const fb = useFeedback()
  const entry = fb.getEntry(turnId, blockId)
  const bookmarked = entry?.bookmarked ?? false
  const tags = entry?.tags ?? []
  const note = entry?.note ?? ''

  const [tagsOpen, setTagsOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [similarOpen, setSimilarOpen] = useState(false)

  // The "似た瞬間" affordance only makes sense for a bookmarked turn with a
  // navigable query context. Both the toggle button and the popover below are
  // gated on `canShowSimilar`, so a stale `similarOpen === true` after the
  // bookmark is removed renders nothing — no need to reconcile the flag during
  // render (which would be a setState-in-render).
  const canShowSimilar = bookmarked && !!similar?.queryText.trim()

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="feedback-cluster" onClick={stop}>
      <button
        className={`feedback-btn feedback-btn--bookmark ${bookmarked ? 'feedback-btn--active' : ''}`}
        title={bookmarked ? 'ブックマークを解除' : 'ブックマーク'}
        aria-pressed={bookmarked}
        onClick={() => fb.toggleBookmark(turnId, blockId)}
      >
        {'⭐'}
      </button>

      <button
        className={`feedback-btn ${tags.length > 0 ? 'feedback-btn--has' : ''} ${tagsOpen ? 'feedback-btn--open' : ''}`}
        title="タグ"
        aria-expanded={tagsOpen}
        onClick={() => setTagsOpen(o => !o)}
      >
        {'🏷'}
        {tags.length > 0 && <span className="feedback-count">{tags.length}</span>}
      </button>

      <button
        className={`feedback-btn ${note ? 'feedback-btn--has' : ''} ${noteOpen ? 'feedback-btn--open' : ''}`}
        title="メモ"
        aria-expanded={noteOpen}
        onClick={() => setNoteOpen(o => !o)}
      >
        {'📝'}
      </button>

      {canShowSimilar && (
        <button
          className={`feedback-btn ${similarOpen ? 'feedback-btn--open' : ''}`}
          title="このブックマークに似た瞬間"
          aria-expanded={similarOpen}
          onClick={() => setSimilarOpen(o => !o)}
        >
          {'🔍'}
        </button>
      )}

      {tagsOpen && (
        <div className="feedback-popover">
          <TagInput
            tags={tags}
            suggestions={fb.allTags}
            onAdd={tag => fb.addTag(turnId, blockId, tag)}
            onRemove={tag => fb.removeTag(turnId, blockId, tag)}
          />
        </div>
      )}

      {noteOpen && (
        <div className="feedback-popover">
          <NoteEditor
            value={note}
            onCommit={next => fb.setNote(turnId, blockId, next)}
          />
        </div>
      )}

      {similarOpen && canShowSimilar && similar && (
        <div className="feedback-popover">
          <SimilarMoments
            queryText={similar.queryText}
            currentSessionId={similar.sessionId}
            currentTurnIndex={turnId}
            onSelect={similar.onSelect}
          />
        </div>
      )}
    </div>
  )
}

interface NoteEditorProps {
  /** Committed note from the store. */
  value: string
  /** Persist the draft to the store. Called on blur and on unmount. */
  onCommit: (note: string) => void
}

/**
 * Note textarea that keeps edits in local state and only commits to the store
 * on blur or unmount, instead of on every keystroke. This avoids a full
 * localStorage write + version bump + tree re-render per character typed.
 */
function NoteEditor({ value, onCommit }: NoteEditorProps) {
  const [draft, setDraft] = useState(value)

  // Re-seed when the committed value changes externally (e.g. a different
  // entry is selected while the editor stays mounted). Done during render via
  // a previous-value tracker rather than an effect, per React's "adjusting
  // state on prop change" guidance — this avoids a setState-in-effect.
  const [seededValue, setSeededValue] = useState(value)
  if (value !== seededValue) {
    setSeededValue(value)
    setDraft(value)
  }

  // Keep the latest draft/value in a ref so the unmount-commit effect can read
  // them without re-running (and thus committing) on every keystroke. The ref
  // is updated in an effect (never during render) per react-hooks/refs.
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => {
    latest.current = { draft, value, onCommit }
  })

  useEffect(() => {
    return () => {
      const { draft: d, value: v, onCommit: commit } = latest.current
      if (d !== v) commit(d)
    }
  }, [])

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <textarea
      className="feedback-note"
      placeholder="メモを追加"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      rows={3}
    />
  )
}
