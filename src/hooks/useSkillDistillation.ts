import { useState, useCallback } from 'react'
import type { DistillRequest, DistillResponse } from '../types'

interface UseSkillDistillationResult {
  distill: (req: DistillRequest) => Promise<void>
  loading: boolean
  result: string | null
  error: string | null
  reset: () => void
}

export function useSkillDistillation(): UseSkillDistillationResult {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  const distill = useCallback(async (req: DistillRequest) => {
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })

      if (!res.ok) {
        const text = await res.text()
        setError(`Server error (${res.status}): ${text}`)
        return
      }

      const data: DistillResponse = await res.json()
      if (data.success && data.distilledMarkdown) {
        setResult(data.distilledMarkdown)
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

  return { distill, loading, result, error, reset }
}
