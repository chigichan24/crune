import type { SessionSummary, ProjectSummary } from '../../types'
import './SessionOverviewCards.css'

interface Props {
  sessions: SessionSummary[]
  projects: ProjectSummary[]
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.round(totalMinutes % 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function SessionOverviewCards({ sessions, projects }: Props) {
  const totalSessions = sessions.length
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const totalToolCalls = sessions.reduce((sum, s) => {
    const tc = s.toolCallCount ?? Object.values(s.toolBreakdown ?? {}).reduce((a: number, b: number) => a + b, 0)
    return sum + tc
  }, 0)
  const uniqueProjects = projects.length

  return (
    <div className="overview-cards">
      <div className="overview-card">
        <span className="overview-card-value">{totalSessions.toLocaleString()}</span>
        <span className="overview-card-label">Total Sessions</span>
      </div>
      <div className="overview-card">
        <span className="overview-card-value">{formatDuration(totalMinutes)}</span>
        <span className="overview-card-label">Total Time</span>
      </div>
      <div className="overview-card">
        <span className="overview-card-value">{totalToolCalls.toLocaleString()}</span>
        <span className="overview-card-label">Tool Calls</span>
      </div>
      <div className="overview-card">
        <span className="overview-card-value">{uniqueProjects.toLocaleString()}</span>
        <span className="overview-card-label">Projects</span>
      </div>
    </div>
  )
}
