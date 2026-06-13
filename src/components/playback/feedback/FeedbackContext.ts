import { createContext, useContext } from 'react'
import type { FeedbackEntry } from '../../../types'

/**
 * Feedback API exposed to playback components, scoped to the current session.
 * Mirrors the PlanModeContext pattern to avoid prop-drilling.
 */
export interface FeedbackContextValue {
  /** Look up the entry for a turn (blockId omitted) or block. */
  getEntry: (turnId: number, blockId?: string) => FeedbackEntry | null
  toggleBookmark: (turnId: number, blockId?: string) => void
  addTag: (turnId: number, blockId: string | undefined, tag: string) => void
  removeTag: (turnId: number, blockId: string | undefined, tag: string) => void
  setNote: (turnId: number, blockId: string | undefined, note: string) => void
  /** All distinct tags across sessions, for autocomplete. */
  allTags: string[]
}

const noop = () => {}

export const FeedbackContext = createContext<FeedbackContextValue>({
  getEntry: () => null,
  toggleBookmark: noop,
  addTag: noop,
  removeTag: noop,
  setNote: noop,
  allTags: [],
})

export function useFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext)
}
