import { useId, useMemo, useState } from 'react'
import { SEMANTIC_TAGS } from './tagSemantics'

interface Props {
  /** Existing tags on the entry. */
  tags: string[]
  /** Tag suggestions for autocomplete (all known tags). */
  suggestions: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
}

/**
 * Controlled tag editor with native <datalist> autocomplete. Submits the
 * current value on Enter, deduping is handled upstream by the store.
 *
 * The two meaningful tags (`reusable` / `anti-pattern`) are always offered
 * first so users can flag turns for the synthesis pipeline without recalling
 * the exact spelling.
 */
export function TagInput({ tags, suggestions, onAdd, onRemove }: Props) {
  const [value, setValue] = useState('')
  const listId = useId()

  // Surface the semantic tags first, then any other known tags (deduped).
  const options = useMemo(() => {
    const seen = new Set<string>(SEMANTIC_TAGS)
    const rest = suggestions.filter(s => !seen.has(s))
    return [...SEMANTIC_TAGS, ...rest]
  }, [suggestions])

  const commit = () => {
    const clean = value.trim()
    if (!clean) return
    onAdd(clean)
    setValue('')
  }

  return (
    <div className="tag-input">
      <div className="tag-input-chips">
        {tags.map(tag => (
          <span key={tag} className="tag-chip">
            {tag}
            <button
              className="tag-chip-remove"
              onClick={() => onRemove(tag)}
              aria-label={`タグ「${tag}」を削除`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className="tag-input-field"
        type="text"
        list={listId}
        placeholder="タグを追加"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
      />
      <datalist id={listId}>
        {options.map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
