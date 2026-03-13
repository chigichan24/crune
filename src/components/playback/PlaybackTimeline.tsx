import { useMemo } from 'react'
import type { ConversationTurn } from '../../types/index.ts'
import './PlaybackTimeline.css'

interface Props {
  turns: ConversationTurn[]
  activeTurnIndex: number
  onTurnSelect: (index: number) => void
}

type DotColor = 'blue' | 'orange' | 'green'

function getDotColor(turn: ConversationTurn): DotColor {
  const hasAgent = turn.assistantBlocks.some(
    b => b.type === 'tool_use' && b.name === 'Agent'
  )
  if (hasAgent) return 'green'

  const hasPlanTool = turn.assistantBlocks.some(
    b =>
      b.type === 'tool_use' &&
      (b.name === 'TodoWrite' ||
        b.name === 'TodoRead' ||
        b.name === 'TaskCreate' ||
        b.name === 'TaskUpdate' ||
        b.name === 'TaskList')
  )
  if (hasPlanTool) return 'orange'

  return 'blue'
}

export function PlaybackTimeline({ turns, activeTurnIndex, onTurnSelect }: Props) {
  const positions = useMemo(() => {
    if (turns.length === 0) return []
    if (turns.length === 1) return [50]

    const timestamps = turns.map(t => new Date(t.timestamp).getTime())
    const min = timestamps[0]
    const max = timestamps[timestamps.length - 1]
    const range = max - min

    if (range === 0) {
      // All same timestamp — distribute evenly
      return turns.map((_, i) => ((i + 1) / (turns.length + 1)) * 100)
    }

    return timestamps.map(ts => {
      const pct = ((ts - min) / range) * 90 + 5 // 5% to 95% range
      return pct
    })
  }, [turns])

  if (turns.length === 0) return null

  return (
    <div className="playback-timeline">
      <div className="timeline-track">
        <div className="timeline-line" />
        {turns.map((turn, i) => {
          const color = getDotColor(turn)
          const isActive = i === activeTurnIndex
          return (
            <button
              key={turn.turnIndex}
              className={`timeline-dot timeline-dot--${color} ${isActive ? 'timeline-dot--active' : ''}`}
              style={{ left: `${positions[i]}%` }}
              onClick={() => onTurnSelect(i)}
              title={`Turn ${turn.turnIndex + 1}`}
            />
          )
        })}
      </div>
    </div>
  )
}
