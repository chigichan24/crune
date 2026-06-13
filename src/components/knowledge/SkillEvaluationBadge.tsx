import type { SkillEvaluation } from '../../types'
import './SkillEvaluationBadge.css'

/** Map an evaluation to a pass/borderline/fail status tone (structural NG -> fail). */
function evalStatus(evaluation: SkillEvaluation): 'pass' | 'borderline' | 'fail' {
  if (!evaluation.structural.valid) return 'fail'
  const score = evaluation.overallScore ?? 0
  if (score >= 70) return 'pass'
  if (score >= 50) return 'borderline'
  return 'fail'
}

interface Props {
  evaluation: SkillEvaluation
  /**
   * CSS class prefix so each host view can keep its own visual styling.
   * e.g. `knd` -> `knd-eval`, `tk` -> `tk-eval`.
   */
  prefix: string
}

/** Compact評価バッジ: 構造の合否、総合スコア、rubric内訳、改善ヒントを表示する。 */
export function SkillEvaluationBadge({ evaluation, prefix }: Props) {
  const status = evalStatus(evaluation)
  const score = evaluation.overallScore ?? 0
  const rubric = evaluation.rubric
  const hints = rubric?.hints ?? []

  return (
    <div className={`${prefix}-eval ${prefix}-eval--${status}`}>
      <div className={`${prefix}-eval-header`}>
        <span className={`${prefix}-eval-chip ${prefix}-eval-chip--${evaluation.structural.valid ? 'ok' : 'ng'}`}>
          構造 {evaluation.structural.valid ? 'OK' : 'NG'}
        </span>
        <span className={`${prefix}-eval-score`}>スコア {score}/100</span>
      </div>

      {!evaluation.structural.valid && evaluation.structural.issues.length > 0 && (
        <ul className={`${prefix}-eval-issues`}>
          {evaluation.structural.issues.map((issue, i) => (
            <li key={i} className={`${prefix}-eval-issue`}>
              <strong>{issue.field}</strong>: {issue.message}
            </li>
          ))}
        </ul>
      )}

      {rubric?.ok && rubric.breakdown && (
        <div className={`${prefix}-eval-breakdown`}>
          <span>名前 {rubric.breakdown.nameQuality}/25</span>
          <span>説明 {rubric.breakdown.descriptionTriggering}/25</span>
          <span>手順 {rubric.breakdown.instructionsConcrete}/25</span>
          <span>ノイズ {rubric.breakdown.noPreambleNoise}/25</span>
        </div>
      )}

      {hints.length > 0 && (
        <div className={`${prefix}-eval-hints`}>
          <span className={`${prefix}-eval-hints-label`}>改善ヒント</span>
          <ul className={`${prefix}-eval-hints-list`}>
            {hints.map((hint, i) => (
              <li key={i} className={`${prefix}-eval-hint`}>{hint}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
