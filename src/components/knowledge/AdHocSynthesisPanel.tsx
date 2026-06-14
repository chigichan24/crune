import { useState } from 'react'
import type { TopicNode, EnrichedToolSequence } from '../../types'
import { useSkillSynthesis } from '../../hooks/useSkillSynthesis'
import { buildAdHocSynthesisRequest } from './adHocSynthesis'
import { SkillCopyButton } from './SkillCopyButton'
import './AdHocSynthesisPanel.css'

interface Props {
  topics: TopicNode[] // the currently filtered topic set
  enrichedSequences: EnrichedToolSequence[]
}

/**
 * Synthesize a single skill from the *whole filtered slice* (issue #73): builds
 * a synthetic union topic and runs it through the skill-server. Needs the local
 * skill-server (npm run dev:full).
 */
export function AdHocSynthesisPanel({ topics, enrichedSequences }: Props) {
  const { synthesize, loading, result, error, reset } = useSkillSynthesis()
  const [open, setOpen] = useState(false)

  if (topics.length < 2) return null // a single topic already has its own card

  const onSynthesize = () => {
    if (loading) return // don't start a second synthesis while one is in flight
    const req = buildAdHocSynthesisRequest(topics, enrichedSequences)
    if (!req) return
    reset()
    setOpen(true)
    synthesize(req)
  }

  return (
    <div className="adhoc">
      <button className="adhoc-btn" onClick={onSynthesize} disabled={loading}>
        {loading ? '合成中…' : `このフィルタ集合から合成 (${topics.length} topics)`}
      </button>
      {open && (result || error) && (
        <div className="adhoc-result">
          {error ? (
            <p className="adhoc-error">{error}</p>
          ) : result ? (
            <>
              <pre className="adhoc-md">{result}</pre>
              <SkillCopyButton text={result} className="adhoc-copy" />
            </>
          ) : null}
          <button className="adhoc-close" onClick={() => setOpen(false)}>
            閉じる
          </button>
        </div>
      )}
    </div>
  )
}
