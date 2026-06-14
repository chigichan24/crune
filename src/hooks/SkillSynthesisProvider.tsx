import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { SynthesisRequest } from '../types'
import { SkillSynthesisContext, runSynthesis, type SynthesisJob } from './skillSynthesisContext'

/**
 * Holds skill-synthesis jobs keyed by a caller-chosen id (topic id, ad-hoc
 * slice id, …) so a synthesis keeps running in the background and its result
 * persists across filter changes / navigation / unmounts (issue #73 follow-up).
 */
export function SkillSynthesisProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, SynthesisJob>>({})
  // Per-key generation counter: every synthesize/reset bumps it, and an
  // in-flight resolution only writes if its generation is still current. This
  // prevents a dismissed (reset) job from being resurrected by a late fetch and
  // a slow earlier re-synthesis from overwriting a faster later one.
  const gen = useRef<Record<string, number>>({})

  const reset = useCallback((key: string) => {
    gen.current[key] = (gen.current[key] ?? 0) + 1 // invalidate any in-flight job
    setJobs((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const synthesize = useCallback((key: string, req: SynthesisRequest) => {
    const generation = (gen.current[key] = (gen.current[key] ?? 0) + 1)
    setJobs((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    void runSynthesis(req).then((job) => {
      if (gen.current[key] !== generation) return // superseded by a reset or newer call
      setJobs((prev) => ({ ...prev, [key]: job }))
    })
  }, [])

  return (
    <SkillSynthesisContext.Provider value={{ jobs, synthesize, reset }}>
      {children}
    </SkillSynthesisContext.Provider>
  )
}
