import { useCallback, useState, type ReactNode } from 'react'
import type { SynthesisRequest } from '../types'
import { SkillSynthesisContext, runSynthesis, type SynthesisJob } from './skillSynthesisContext'

/**
 * Holds skill-synthesis jobs keyed by a caller-chosen id (topic id, ad-hoc
 * slice id, …) so a synthesis keeps running in the background and its result
 * persists across filter changes / navigation / unmounts (issue #73 follow-up).
 */
export function SkillSynthesisProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, SynthesisJob>>({})

  const reset = useCallback((key: string) => {
    setJobs((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const synthesize = useCallback((key: string, req: SynthesisRequest) => {
    setJobs((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    void runSynthesis(req).then((job) => {
      setJobs((prev) => ({ ...prev, [key]: job }))
    })
  }, [])

  return (
    <SkillSynthesisContext.Provider value={{ jobs, synthesize, reset }}>
      {children}
    </SkillSynthesisContext.Provider>
  )
}
