import { useCallback, useMemo, useState } from 'react'
import type { FeedbackContextValue } from '../components/playback/feedback/FeedbackContext'
import type { FeedbackEntry } from '../types'
import {
  addTag as storeAddTag,
  collectAllTags,
  entryKey,
  loadSessionFeedback,
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

  // Parse the current session's feedback blob exactly once per mutation and
  // index it by entryKey, so per-block/per-turn lookups during a render are
  // O(1) instead of a full getItem + JSON.parse of the whole blob each call.
  const entryMap = useMemo(() => {
    const map = new Map<string, FeedbackEntry>()
    if (!sessionId) return map
    for (const entry of loadSessionFeedback(sessionId)) {
      map.set(entryKey(entry.turnId, entry.blockId), entry)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload after every mutation
  }, [sessionId, version])

  const getEntry = useCallback(
    (turnId: number, blockId?: string) =>
      entryMap.get(entryKey(turnId, blockId)) ?? null,
    [entryMap],
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
