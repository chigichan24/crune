import { useEffect, useRef, useState } from 'react'
import { useFeedback } from './FeedbackContext'
import { TagInput } from './TagInput'
import './FeedbackCluster.css'

interface Props {
  turnId: number
  /** Tool-call block id (toolUseId) for block-level feedback; absent = turn-level. */
  blockId?: string
}

/**
 * Icon cluster for bookmark / tags / note feedback on a turn or tool-call
 * block. Reads and writes via FeedbackContext. Tags and note open inline
 * popovers using the expand/collapse convention (useState + conditional
 * render, no animation).
 */
export function FeedbackCluster({ turnId, blockId }: Props) {
  const fb = useFeedback()
  const entry = fb.getEntry(turnId, blockId)
  const bookmarked = entry?.bookmarked ?? false
  const tags = entry?.tags ?? []
  const note = entry?.note ?? ''

  const [tagsOpen, setTagsOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)

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
