import type { SessionSummary, ProjectSummary } from '../../types'
import { useSessionOverview } from '../../hooks/useSessionOverview'
import { SessionOverviewCards } from './SessionOverviewCards'
import { SessionActivityHeatmap } from './SessionActivityHeatmap'
import { SessionProjectDistribution } from './SessionProjectDistribution'
import { SessionModelUsage } from './SessionModelUsage'
import { SessionToolTrends } from './SessionToolTrends'
import { SessionDurationDistribution } from './SessionDurationDistribution'
import { SessionTopFiles } from './SessionTopFiles'
import { SessionList } from './SessionList'
import './SessionDashboardView.css'

interface Props {
  sessions: SessionSummary[]
  projects: ProjectSummary[]
  onSessionSelect: (sessionId: string) => void
}

export function SessionDashboardView({ sessions, projects, onSessionSelect }: Props) {
  const { data: overview, loading, error } = useSessionOverview()

  if (loading) {
    return <div className="dashboard-status">概要データを読み込み中...</div>
  }

  if (error) {
    return <div className="dashboard-status dashboard-error">Error: {error}</div>
  }

  if (!overview) {
    return <div className="dashboard-status">概要データがありません</div>
  }

  // overview.json has flat structure (no nested "statistics" key)
  const stats = overview as any

  return (
    <div className="session-dashboard">
      <SessionOverviewCards sessions={sessions} projects={projects} />

      <div className="dashboard-section dashboard-section--full">
        <h2 className="dashboard-section-title">Sessions</h2>
        <SessionList
          sessions={sessions}
          projects={projects}
          onSessionSelect={onSessionSelect}
        />
      </div>

      <div className="dashboard-grid dashboard-grid--three">
        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Activity Heatmap</h2>
          <SessionActivityHeatmap heatmap={stats.activityHeatmap} />
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Project Distribution</h2>
          <SessionProjectDistribution distribution={stats.projectDistribution} />
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Model Usage</h2>
          <SessionModelUsage usage={stats.modelUsage} />
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Weekly Tool Trends</h2>
          <SessionToolTrends trends={stats.weeklyToolTrends} />
        </div>

        <div className="dashboard-section">
          <h2 className="dashboard-section-title">Session Duration Distribution</h2>
          <SessionDurationDistribution distribution={stats.durationDistribution} />
        </div>
      </div>

      <div className="dashboard-section dashboard-section--full">
        <h2 className="dashboard-section-title">Top Files</h2>
        <SessionTopFiles files={stats.topFiles} />
      </div>
    </div>
  )
}
