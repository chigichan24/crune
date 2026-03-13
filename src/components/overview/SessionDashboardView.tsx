import type { SessionSummary, ProjectSummary } from '../../types'
import { useSessionOverview } from '../../hooks/useSessionOverview'
import { SessionOverviewCards } from './SessionOverviewCards'
import './SessionDashboardView.css'

interface Props {
  sessions: SessionSummary[]
  projects: ProjectSummary[]
  onSessionSelect: (sessionId: string) => void
}

export function SessionDashboardView({ sessions, projects, onSessionSelect }: Props) {
  const { data: overview, loading, error } = useSessionOverview()

  if (loading) {
    return <div className="dashboard-status">Loading overview data...</div>
  }

  if (error) {
    return <div className="dashboard-status dashboard-error">Error: {error}</div>
  }

  if (!overview) {
    return <div className="dashboard-status">No overview data available.</div>
  }

  const { statistics } = overview

  // Will be used in subsequent commits for chart components
  void statistics
  void onSessionSelect

  return (
    <div className="session-dashboard">
      <SessionOverviewCards sessions={sessions} projects={projects} />

      <div className="dashboard-grid">
        <div className="dashboard-section dashboard-section--wide">
          <h2 className="dashboard-section-title">Activity Heatmap</h2>
          <div className="placeholder">Heatmap (coming soon)</div>
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Project Distribution</h2>
          <div className="placeholder">Project chart (coming soon)</div>
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Model Usage</h2>
          <div className="placeholder">Model chart (coming soon)</div>
        </div>

        <div className="dashboard-section dashboard-section--wide">
          <h2 className="dashboard-section-title">Weekly Tool Trends</h2>
          <div className="placeholder">Tool trends (coming soon)</div>
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Session Duration Distribution</h2>
          <div className="placeholder">Duration chart (coming soon)</div>
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Top Files</h2>
          <div className="placeholder">File table (coming soon)</div>
        </div>

        <div className="dashboard-section dashboard-section--full">
          <h2 className="dashboard-section-title">Sessions</h2>
          <div className="placeholder">Session list (coming soon)</div>
        </div>
      </div>
    </div>
  )
}
