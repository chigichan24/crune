import { describe, it, expect, beforeEach } from 'vitest'
import {
  FEEDBACK_STORAGE_KEY,
  addTag,
  collectAllTags,
  entryKey,
  getEntry,
  loadSessionFeedback,
  removeEntry,
  removeTag,
  setNote,
  toggleBookmark,
  upsertEntry,
} from '../feedback/feedbackStore'
import type { FeedbackEntry } from '../../../types'

/** Minimal in-memory Storage fake (no jsdom). */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  }
}

describe('entryKey', () => {
  it('uses just the turnId for turn-level feedback', () => {
    expect(entryKey(3)).toBe('3')
  })

  it('combines turnId and blockId for block-level feedback', () => {
    expect(entryKey(3, 'tool-abc')).toBe('3:b:tool-abc')
  })

  it('keeps an empty-string blockId distinct from the turn-level key', () => {
    // A tool_use block with a missing id yields blockId='' but must NOT collapse
    // onto the turn-level key, otherwise it would overwrite turn feedback.
    expect(entryKey(3, '')).toBe('3:b:')
    expect(entryKey(3, '')).not.toBe(entryKey(3))
  })
})

describe('feedbackStore', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it('returns an empty list for an unknown session', () => {
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('upserts a new turn-level entry', () => {
    upsertEntry('s1', 2, undefined, { note: 'hi' }, storage)
    const entry = getEntry('s1', 2, undefined, storage)
    expect(entry).toMatchObject({ sessionId: 's1', turnId: 2, note: 'hi', bookmarked: false, tags: [] })
    expect(entry?.blockId).toBeUndefined()
  })

  it('upserts a block-level entry distinct from the turn-level one', () => {
    upsertEntry('s1', 2, undefined, { note: 'turn' }, storage)
    upsertEntry('s1', 2, 'blk', { note: 'block' }, storage)
    expect(getEntry('s1', 2, undefined, storage)?.note).toBe('turn')
    expect(getEntry('s1', 2, 'blk', storage)?.note).toBe('block')
    expect(loadSessionFeedback('s1', storage)).toHaveLength(2)
  })

  it('does not let an empty-blockId block overwrite turn-level feedback', () => {
    upsertEntry('s1', 2, undefined, { note: 'turn' }, storage)
    upsertEntry('s1', 2, '', { note: 'block-empty-id' }, storage)
    expect(getEntry('s1', 2, undefined, storage)?.note).toBe('turn')
    expect(getEntry('s1', 2, '', storage)?.note).toBe('block-empty-id')
    expect(loadSessionFeedback('s1', storage)).toHaveLength(2)
  })

  it('keeps distinct surrogate blockIds from colliding', () => {
    upsertEntry('s1', 2, 'idx-0', { note: 'first' }, storage)
    upsertEntry('s1', 2, 'idx-1', { note: 'second' }, storage)
    expect(getEntry('s1', 2, 'idx-0', storage)?.note).toBe('first')
    expect(getEntry('s1', 2, 'idx-1', storage)?.note).toBe('second')
    expect(loadSessionFeedback('s1', storage)).toHaveLength(2)
  })

  it('merges fields on subsequent upserts of the same key', () => {
    upsertEntry('s1', 1, undefined, { note: 'first' }, storage)
    upsertEntry('s1', 1, undefined, { bookmarked: true }, storage)
    const entry = getEntry('s1', 1, undefined, storage)
    expect(entry).toMatchObject({ note: 'first', bookmarked: true })
  })

  it('toggles a bookmark on and off, pruning the empty entry when off', () => {
    expect(toggleBookmark('s1', 1, undefined, storage)).toBe(true)
    expect(getEntry('s1', 1, undefined, storage)?.bookmarked).toBe(true)
    expect(toggleBookmark('s1', 1, undefined, storage)).toBe(false)
    // Un-bookmarking leaves no bookmark/tags/note, so the entry is pruned.
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('adds tags and dedupes them', () => {
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'refactor', storage)
    expect(getEntry('s1', 1, undefined, storage)?.tags).toEqual(['bug', 'refactor'])
  })

  it('ignores empty/whitespace tags', () => {
    addTag('s1', 1, undefined, '   ', storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
  })

  it('removes a tag', () => {
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'refactor', storage)
    removeTag('s1', 1, undefined, 'bug', storage)
    expect(getEntry('s1', 1, undefined, storage)?.tags).toEqual(['refactor'])
  })

  it('sets a note', () => {
    setNote('s1', 1, undefined, 'remember this', storage)
    expect(getEntry('s1', 1, undefined, storage)?.note).toBe('remember this')
  })

  it('prunes the entry when a note is cleared back to blank', () => {
    setNote('s1', 1, undefined, 'remember this', storage)
    setNote('s1', 1, undefined, '', storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('treats a whitespace-only note as empty and prunes it', () => {
    setNote('s1', 1, undefined, '   ', storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
  })

  it('prunes the entry and drops the session bucket when the last tag is removed', () => {
    addTag('s1', 1, undefined, 'bug', storage)
    removeTag('s1', 1, undefined, 'bug', storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
    // Session bucket is dropped entirely, not left as an empty array.
    const raw = storage.getItem(FEEDBACK_STORAGE_KEY)
    expect(raw ? Object.keys(JSON.parse(raw)) : []).not.toContain('s1')
  })

  it('keeps an entry that still has a bookmark when its note is cleared', () => {
    toggleBookmark('s1', 1, undefined, storage)
    setNote('s1', 1, undefined, 'temp', storage)
    setNote('s1', 1, undefined, '', storage)
    expect(getEntry('s1', 1, undefined, storage)?.bookmarked).toBe(true)
  })

  it('removes an entry', () => {
    upsertEntry('s1', 1, undefined, { note: 'x' }, storage)
    removeEntry('s1', 1, undefined, storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('collects all distinct tags across all sessions, sorted', () => {
    addTag('s1', 1, undefined, 'zebra', storage)
    addTag('s1', 2, undefined, 'apple', storage)
    addTag('s2', 1, 'blk', 'apple', storage)
    addTag('s2', 1, 'blk', 'mango', storage)
    expect(collectAllTags(storage)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('isolates feedback per session', () => {
    upsertEntry('s1', 1, undefined, { note: 'one' }, storage)
    upsertEntry('s2', 1, undefined, { note: 'two' }, storage)
    expect(loadSessionFeedback('s1', storage)).toHaveLength(1)
    expect(loadSessionFeedback('s2', storage)).toHaveLength(1)
    expect(getEntry('s2', 1, undefined, storage)?.note).toBe('two')
  })

  it('recovers from malformed JSON in storage', () => {
    storage.setItem(FEEDBACK_STORAGE_KEY, '{not valid json')
    expect(loadSessionFeedback('s1', storage)).toEqual([])
    // and can still write afterwards
    upsertEntry('s1', 1, undefined, { note: 'ok' }, storage)
    expect(getEntry('s1', 1, undefined, storage)?.note).toBe('ok')
  })

  it('recovers when stored blob is not an object', () => {
    storage.setItem(FEEDBACK_STORAGE_KEY, '42')
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('normalizes an entry missing tags/note/bookmarked on read', () => {
    // Simulate an old/corrupted record lacking tags and note.
    storage.setItem(
      FEEDBACK_STORAGE_KEY,
      JSON.stringify({ s1: [{ sessionId: 's1', turnId: 1 }] }),
    )
    const entry = getEntry('s1', 1, undefined, storage)
    expect(entry).toMatchObject({ sessionId: 's1', turnId: 1, tags: [], note: '', bookmarked: false })
    // removeTag must not throw on the (now normalized) entry.
    expect(() => removeTag('s1', 1, undefined, 'whatever', storage)).not.toThrow()
  })

  it('drops entries failing the minimal shape check', () => {
    storage.setItem(
      FEEDBACK_STORAGE_KEY,
      JSON.stringify({
        s1: [
          { sessionId: 's1', turnId: 1, note: 'good' },
          { sessionId: 's1' }, // missing turnId
          null,
          'garbage',
          { turnId: 2 }, // missing sessionId
        ],
      }),
    )
    const entries = loadSessionFeedback('s1', storage)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ turnId: 1, note: 'good' })
  })

  it('coerces a non-array tags field to an empty array', () => {
    storage.setItem(
      FEEDBACK_STORAGE_KEY,
      JSON.stringify({ s1: [{ sessionId: 's1', turnId: 1, tags: 'oops', note: 'x' }] }),
    )
    expect(getEntry('s1', 1, undefined, storage)?.tags).toEqual([])
  })

  it('persists across independent reads (serialized in storage)', () => {
    upsertEntry('s1', 5, 'blk', { note: 'persisted', tags: ['x'] } as Partial<FeedbackEntry>, storage)
    const raw = storage.getItem(FEEDBACK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const reread = loadSessionFeedback('s1', storage)
    expect(reread).toHaveLength(1)
    expect(reread[0]).toMatchObject({ turnId: 5, blockId: 'blk', note: 'persisted', tags: ['x'] })
  })
})
