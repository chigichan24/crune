import { useId, useState } from 'react'

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
 */
export function TagInput({ tags, suggestions, onAdd, onRemove }: Props) {
  const [value, setValue] = useState('')
  const listId = useId()

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
        {suggestions.map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
