import type { KnowledgeGraphMetrics, KnowledgeCommunity } from '../../types'
import './GraphMetricsPanel.css'

interface Props {
  metrics: KnowledgeGraphMetrics
  communities: KnowledgeCommunity[]
}

export function GraphMetricsPanel({ metrics, communities }: Props) {
  return (
    <div className="graph-metrics-panel">
      <div className="gmp-stats">
        <div className="gmp-stat">
          <span className="gmp-stat-value">{metrics.totalTopics}</span>
          <span className="gmp-stat-label">Topics</span>
        </div>
        <div className="gmp-stat">
          <span className="gmp-stat-value">{metrics.totalEdges}</span>
          <span className="gmp-stat-label">Edges</span>
        </div>
        <div className="gmp-stat">
          <span className="gmp-stat-value">{communities.length}</span>
          <span className="gmp-stat-label">Communities</span>
        </div>
        <div className="gmp-stat">
          <span className="gmp-stat-value">
            {(metrics.graphDensity * 100).toFixed(1)}%
          </span>
          <span className="gmp-stat-label">Density</span>
        </div>
        <div className="gmp-stat">
          <span className="gmp-stat-value">
            {metrics.modularity.toFixed(3)}
          </span>
          <span className="gmp-stat-label">Modularity</span>
        </div>
        <div className="gmp-stat">
          <span className="gmp-stat-value">{metrics.isolatedTopicCount}</span>
          <span className="gmp-stat-label">Isolated</span>
        </div>
      </div>
      {metrics.bridgeTopicIds.length > 0 && (
        <div className="gmp-bridges">
          <span className="gmp-bridges-label">
            Bridge Topics: {metrics.bridgeTopicIds.length}
          </span>
        </div>
      )}
    </div>
  )
}
