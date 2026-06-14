import { useCallback, useContext } from 'react'
import { SkillSynthesisContext } from './skillSynthesisContext'
import type { SynthesisRequest } from '../types'

interface UseSkillSynthesisResult {
  synthesize: (req: SynthesisRequest) => void
  loading: boolean
  result: string | null
  error: string | null
  reset: () => void
}

/**
 * Read/trigger the synthesis job tracked under `key` (a stable id for the thing
 * being synthesized — a topic id or an ad-hoc slice id). State lives in the
 * SkillSynthesisProvider, so the job keeps running and its result persists even
 * if this component unmounts (filter change, tab switch, …).
 */
export function useSkillSynthesis(key: string): UseSkillSynthesisResult {
  const ctx = useContext(SkillSynthesisContext)
  if (!ctx) {
    throw new Error('useSkillSynthesis must be used within a SkillSynthesisProvider')
  }
  const job = ctx.jobs[key]

  const { synthesize: ctxSynthesize, reset: ctxReset } = ctx
  const synthesize = useCallback(
    (req: SynthesisRequest) => ctxSynthesize(key, req),
    [ctxSynthesize, key],
  )
  const reset = useCallback(() => ctxReset(key), [ctxReset, key])

  return {
    synthesize,
    loading: job?.status === 'loading',
    result: job?.status === 'success' ? job.markdown ?? null : null,
    error: job?.status === 'error' ? job.error ?? null : null,
    reset,
  }
}
