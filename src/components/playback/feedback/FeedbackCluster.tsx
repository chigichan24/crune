import { useState } from 'react'
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
          <textarea
            className="feedback-note"
            placeholder="メモを追加"
            value={note}
            onChange={e => fb.setNote(turnId, blockId, e.target.value)}
            rows={3}
          />
        </div>
      )}
    </div>
  )
}
