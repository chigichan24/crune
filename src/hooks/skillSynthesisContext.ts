import { createContext } from 'react'
import type { SynthesisRequest, SynthesisResponse } from '../types'

export interface SynthesisJob {
  status: 'loading' | 'success' | 'error'
  markdown?: string
  error?: string
}

/** Run one synthesis and map the response/failure to a terminal job state. */
export async function runSynthesis(req: SynthesisRequest): Promise<SynthesisJob> {
  try {
    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const text = await res.text()
      return { status: 'error', error: `Server error (${res.status}): ${text}` }
    }
    const data: SynthesisResponse = await res.json()
    if (data.success && data.synthesizedMarkdown) {
      return { status: 'success', markdown: data.synthesizedMarkdown }
    }
    return { status: 'error', error: data.error ?? 'Unknown error' }
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('fetch')) {
      return { status: 'error', error: 'Skill server is not running. Start it with: npm run skill-server' }
    }
    return { status: 'error', error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export interface SkillSynthesisContextValue {
  jobs: Record<string, SynthesisJob>
  /** Start (or restart) a synthesis tracked under `key`. Fire-and-forget: the
   *  fetch lives in the provider, so it survives the caller unmounting. */
  synthesize: (key: string, req: SynthesisRequest) => void
  reset: (key: string) => void
}

export const SkillSynthesisContext = createContext<SkillSynthesisContextValue | null>(null)
