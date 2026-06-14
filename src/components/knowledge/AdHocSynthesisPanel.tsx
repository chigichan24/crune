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
 * a synthetic union topic and runs it through the skill-server. The job is keyed
 * per slice in the SkillSynthesisProvider, so it keeps running in the background
 * and its result persists when you change filters and come back. Needs the local
 * skill-server (npm run dev:full).
 */
export function AdHocSynthesisPanel({ topics, enrichedSequences }: Props) {
  const sliceKey = `adhoc:${topics.map((t) => t.id).sort().join(',')}`
  const { synthesize, loading, result, error, reset } = useSkillSynthesis(sliceKey)

  if (topics.length < 2) return null // a single topic already has its own card

  const onSynthesize = () => {
    if (loading) return // a synthesis for this slice is already in flight
    const req = buildAdHocSynthesisRequest(topics, enrichedSequences)
    if (req) synthesize(req)
  }

  return (
    <div className="adhoc">
      <button className="adhoc-btn" onClick={onSynthesize} disabled={loading}>
        {loading ? '合成中…' : `このフィルタ集合から合成 (${topics.length} topics)`}
      </button>
      {(result || error) && (
        <div className="adhoc-result">
          {error ? (
            <p className="adhoc-error">{error}</p>
          ) : result ? (
            <>
              <pre className="adhoc-md">{result}</pre>
              <SkillCopyButton text={result} className="adhoc-copy" />
            </>
          ) : null}
          <button className="adhoc-close" onClick={reset}>
            閉じる
          </button>
        </div>
      )}
    </div>
  )
}
