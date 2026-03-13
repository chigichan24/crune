import { useState, useEffect, useCallback, useRef } from 'react'
import { useSessionDetail } from '../../hooks/useSessionDetail.ts'
import { PlaybackStep } from './PlaybackStep.tsx'
import { PlaybackSidePanel } from './PlaybackSidePanel.tsx'
import './SessionPlayback.css'

interface Props {
  sessionId: string | null
  onClose: () => void
}

type DotColor = 'blue' | 'orange' | 'green'

function getDotColor(turn: any): DotColor {
  const toolCalls = turn.toolCalls ?? []
  const hasAgent = toolCalls.some((tc: any) => tc.toolName === 'Agent')
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

export function SessionPlayback({ sessionId, onClose }: Props) {
  const { data, loading, error } = useSessionDetail(sessionId)
  const [activeTurnIndex, setActiveTurnIndex] = useState(0)
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Reset active turn when session changes
  useEffect(() => {
    setActiveTurnIndex(0)
  }, [sessionId])

  // Scroll active turn into view
  useEffect(() => {
    const el = turnRefs.current.get(activeTurnIndex)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeTurnIndex])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!data) return
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveTurnIndex(prev => Math.min(prev + 1, data.turns.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveTurnIndex(prev => Math.max(prev - 1, 0))
      }
    },
    [data, onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const setTurnRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      turnRefs.current.set(index, el)
    } else {
      turnRefs.current.delete(index)
    }
  }, [])

  if (!sessionId) {
    return null
  }

  if (loading) {
    return <div className="playback-loading">Loading session...</div>
  }

  if (error) {
    return <div className="playback-error">Error: {error}</div>
  }

  if (!data) {
    return <div className="playback-empty">No session data available</div>
  }

  const { meta: rawMeta, turns, subagents } = data
  const meta = rawMeta as any

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return `${h}h ${m}m`
  }

  return (
    <div className="session-playback">
      <div className="playback-header">
        <div className="playback-header-info">
          <h2 className="playback-project">{meta.project}</h2>
          <div className="playback-meta-row">
            {(meta.branch || meta.gitBranch) && (
              <span className="playback-badge playback-badge--branch">
                {meta.branch || meta.gitBranch}
              </span>
            )}
            <span className="playback-badge playback-badge--duration">
              {formatDuration(meta.durationMinutes)}
            </span>
            {meta.slug && (
              <span className="playback-badge playback-badge--slug">
                {meta.slug}
              </span>
            )}
            <span className="playback-badge playback-badge--turns">
              {turns.length} turns
            </span>
          </div>
        </div>
        <button className="playback-close-button" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="playback-body">
        <div className="playback-content">
          {turns.map((turn, i) => {
            const dotColor = getDotColor(turn)
            const isActive = i === activeTurnIndex
            const isLast = i === turns.length - 1
            return (
              <div
                key={turn.turnIndex}
                className="playback-turn"
                ref={el => setTurnRef(i, el)}
                onClick={() => setActiveTurnIndex(i)}
              >
                <div className="turn-timeline">
                  <button
                    className={`turn-dot turn-dot--${dotColor} ${isActive ? 'turn-dot--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setActiveTurnIndex(i) }}
                    title={`Turn ${turn.turnIndex + 1}`}
                  />
                  {!isLast && <div className="turn-line" />}
                </div>
                <div className="turn-content">
                  <PlaybackStep
                    turn={turn}
                    isActive={isActive}
                    subagents={subagents}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <PlaybackSidePanel detail={data} />
      </div>
    </div>
  )
}
