import { useState, useEffect, useCallback, useRef } from 'react'
import { useSessionDetail } from '../../hooks/useSessionDetail.ts'
import { PlaybackTimeline } from './PlaybackTimeline.tsx'
import { PlaybackStep } from './PlaybackStep.tsx'
import { PlaybackSidePanel } from './PlaybackSidePanel.tsx'
import './SessionPlayback.css'

interface Props {
  sessionId: string | null
  onBack: () => void
}

export function SessionPlayback({ sessionId, onBack }: Props) {
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveTurnIndex(prev => Math.min(prev + 1, data.turns.length - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveTurnIndex(prev => Math.max(prev - 1, 0))
      }
    },
    [data]
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
    return (
      <div className="playback-empty">
        Select a session from Overview to start playback
      </div>
    )
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

  const { meta, turns, subagents } = data

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
            {meta.gitBranch && (
              <span className="playback-badge playback-badge--branch">
                {meta.gitBranch}
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
        <button className="playback-back-button" onClick={onBack}>
          Back to Overview
        </button>
      </div>

      <PlaybackTimeline
        turns={turns}
        activeTurnIndex={activeTurnIndex}
        onTurnSelect={setActiveTurnIndex}
      />

      <div className="playback-body">
        <div className="playback-content">
          {turns.map((turn, i) => (
            <div
              key={turn.turnIndex}
              ref={el => setTurnRef(i, el)}
              onClick={() => setActiveTurnIndex(i)}
            >
              <PlaybackStep
                turn={turn}
                isActive={i === activeTurnIndex}
                subagents={subagents}
              />
            </div>
          ))}
        </div>
        <PlaybackSidePanel detail={data} />
      </div>
    </div>
  )
}
