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
    if (data.success) {
      return data.synthesizedMarkdown
        ? { status: 'success', markdown: data.synthesizedMarkdown }
        : { status: 'error', error: 'Empty synthesis result' }
    }
    return { status: 'error', error: data.error ?? 'Unknown error' }
  } catch (e) {
    // fetch() rejects with a TypeError on a connection failure (the server not
    // running); a bad JSON body rejects with SyntaxError, handled separately.
    // Don't match on the message text — it differs across browsers.
    if (e instanceof TypeError) {
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
