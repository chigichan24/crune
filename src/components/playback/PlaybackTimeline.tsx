import { useMemo } from 'react'
import './PlaybackTimeline.css'

interface Props {
  turns: any[]
  activeTurnIndex: number
  onTurnSelect: (index: number) => void
}

type DotColor = 'blue' | 'orange' | 'green'

function getDotColor(turn: any): DotColor {
  const toolCalls = turn.toolCalls ?? []
  const hasAgent = toolCalls.some(
    (tc: any) => tc.toolName === 'Agent'
  )
  if (hasAgent) return 'green'

  const hasPlanTool = toolCalls.some(
    (tc: any) =>
      tc.toolName === 'EnterPlanMode' ||
      tc.toolName === 'ExitPlanMode' ||
      tc.toolName === 'TaskCreate' ||
      tc.toolName === 'TaskUpdate'
  )
  if (hasPlanTool) return 'orange'

  return 'blue'
}

export function PlaybackTimeline({ turns, activeTurnIndex, onTurnSelect }: Props) {
  const positions = useMemo(() => {
    if (turns.length === 0) return []
    if (turns.length === 1) return [50]

    const timestamps = turns.map((t: any) => new Date(t.timestamp).getTime())
    const min = timestamps[0]
    const max = timestamps[timestamps.length - 1]
    const range = max - min

    if (range === 0) {
      return turns.map((_: any, i: number) => ((i + 1) / (turns.length + 1)) * 100)
    }

    return timestamps.map((ts: number) => {
      const pct = ((ts - min) / range) * 90 + 5
      return pct
    })
  }, [turns])

  if (turns.length === 0) return null

  return (
    <div className="playback-timeline">
      <div className="timeline-track">
        <div className="timeline-line" />
        {turns.map((turn: any, i: number) => {
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
