import { useCallback, useMemo, useState } from 'react'
import type { FeedbackContextValue } from '../components/playback/feedback/FeedbackContext'
import {
  addTag as storeAddTag,
  collectAllTags,
  getEntry as storeGetEntry,
  removeTag as storeRemoveTag,
  setNote as storeSetNote,
  toggleBookmark as storeToggleBookmark,
} from '../components/playback/feedback/feedbackStore'

/**
 * React binding over the pure feedbackStore, scoped to one session.
 *
 * The store itself is the source of truth (localStorage); this hook keeps a
 * `version` counter that is bumped after every mutation so consuming
 * components re-render. Returns a value shaped for FeedbackContext.
 */
export function useSessionFeedback(sessionId: string | null): FeedbackContextValue {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion(v => v + 1), [])

  const getEntry = useCallback(
    (turnId: number, blockId?: string) =>
      sessionId ? storeGetEntry(sessionId, turnId, blockId) : null,
    // `version` is intentionally a dependency so this fn's identity changes
    // after every mutation, forcing consumers to re-read the latest entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, version],
  )

  const toggleBookmark = useCallback(
    (turnId: number, blockId?: string) => {
      if (!sessionId) return
      storeToggleBookmark(sessionId, turnId, blockId)
      bump()
    },
    [sessionId, bump],
  )

  const addTag = useCallback(
    (turnId: number, blockId: string | undefined, tag: string) => {
      if (!sessionId) return
      storeAddTag(sessionId, turnId, blockId, tag)
      bump()
    },
    [sessionId, bump],
  )

  const removeTag = useCallback(
    (turnId: number, blockId: string | undefined, tag: string) => {
      if (!sessionId) return
      storeRemoveTag(sessionId, turnId, blockId, tag)
      bump()
    },
    [sessionId, bump],
  )

  const setNote = useCallback(
    (turnId: number, blockId: string | undefined, note: string) => {
      if (!sessionId) return
      storeSetNote(sessionId, turnId, blockId, note)
      bump()
    },
    [sessionId, bump],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when feedback changes
  const allTags = useMemo(() => collectAllTags(), [version, sessionId])

  return useMemo(
    () => ({ getEntry, toggleBookmark, addTag, removeTag, setNote, allTags }),
    [getEntry, toggleBookmark, addTag, removeTag, setNote, allTags],
  )
}
