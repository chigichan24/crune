import { useState, useCallback } from 'react'
import type { SynthesisRequest, SynthesisResponse } from '../types'

interface UseSkillSynthesisResult {
  synthesize: (req: SynthesisRequest) => Promise<void>
  loading: boolean
  result: string | null
  error: string | null
  reset: () => void
}

export function useSkillSynthesis(): UseSkillSynthesisResult {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  const synthesize = useCallback(async (req: SynthesisRequest) => {
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })

      if (!res.ok) {
        const text = await res.text()
        setError(`Server error (${res.status}): ${text}`)
        return
      }

      const data: SynthesisResponse = await res.json()
      if (data.success && data.synthesizedMarkdown) {
        setResult(data.synthesizedMarkdown)
      } else {
        setError(data.error ?? 'Unknown error')
      }
    } catch (e) {
      if (e instanceof TypeError && e.message.includes('fetch')) {
        setError('Skill server is not running. Start it with: npm run skill-server')
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  return { synthesize, loading, result, error, reset }
}
