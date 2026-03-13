import type { ConversationTurn, SubagentSession } from '../../types/index.ts'
import './PlaybackStep.css'

interface Props {
  turn: ConversationTurn
  isActive: boolean
  subagents: Record<string, SubagentSession>
}

export function PlaybackStep({ turn, isActive, subagents: _subagents }: Props) {
  return (
    <div className={`playback-step ${isActive ? 'playback-step--active' : ''}`}>
      <div className="step-placeholder">
        Turn {turn.turnIndex + 1} (implementation pending)
      </div>
    </div>
  )
}
