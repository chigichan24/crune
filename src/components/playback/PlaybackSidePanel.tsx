import { useState, useMemo } from 'react'
import { usePlanMode } from './PlanModeContext'
import './PlaybackSidePanel.css'

interface Props {
  detail: any
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PlaybackSidePanel({ detail }: Props) {
  const meta = detail.meta ?? {}
  const turns = detail.turns ?? []
  const linkedPlan = detail.linkedPlan ?? null
  const isPlanMode = usePlanMode()

  const [detailsExpanded, setDetailsExpanded] = useState(!linkedPlan)

  // Compute tool breakdown from turns
  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const turn of turns) {
      for (const tc of turn.toolCalls ?? []) {
        const name = tc.toolName ?? 'unknown'
        counts[name] = (counts[name] ?? 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [turns])

  const totalToolCalls = toolCounts.reduce((sum, [, c]) => sum + c, 0)

  // Extract files edited from Edit/Write tool calls
  const filesEdited = useMemo(() => {
    const files = new Set<string>()
    for (const turn of turns) {
      for (const tc of turn.toolCalls ?? []) {
        if (
          (tc.toolName === 'Edit' || tc.toolName === 'Write') &&
          tc.input?.file_path
        ) {
          files.add(tc.input.file_path)
        }
      }
    }
    return Array.from(files).sort()
  }, [turns])

  const detailsSummary = `${totalToolCalls} tools, ${filesEdited.length} files`

  return (
    <aside className="playback-side-panel">
      {/* Linked Plan — primary zone */}
      {linkedPlan && (
        <div className="side-plan-zone">
          <div className="side-plan-header">
            <h3 className="side-plan-title">Linked Plan</h3>
            <span className="linked-plan-slug">{linkedPlan.slug}</span>
          </div>
          <pre className="linked-plan-content">{linkedPlan.content}</pre>
        </div>
      )}

      {/* Details — collapsible secondary zone */}
      <div className={`side-details-zone${!linkedPlan ? ' side-details-zone--primary' : ''}`}>
        <button
          className="side-details-toggle"
          onClick={() => setDetailsExpanded(prev => !prev)}
        >
          <span className="side-details-icon">{detailsExpanded ? '\u25BC' : '\u25B6'}</span>
          <span>Details</span>
          {!detailsExpanded && (
            <span className="side-details-summary">{detailsSummary}</span>
          )}
        </button>

        {detailsExpanded && (
          <div className="side-details-body">
            {/* Session Info */}
            <section className="side-section">
              <h3 className="side-section-title">Session Info</h3>
              <dl className="side-info-list">
                <div className="side-info-item">
                  <dt>Project</dt>
                  <dd>{meta.project}</dd>
                </div>
                {meta.branch && (
                  <div className="side-info-item">
                    <dt>Branch</dt>
                    <dd>{meta.branch}</dd>
                  </div>
                )}
                <div className="side-info-item">
                  <dt>CWD</dt>
                  <dd className="side-info-mono">{meta.cwd}</dd>
                </div>
                {meta.version && (
                  <div className="side-info-item">
                    <dt>Version</dt>
                    <dd>{meta.version}</dd>
                  </div>
                )}
                <div className="side-info-item">
                  <dt>Duration</dt>
                  <dd>{formatDuration(meta.durationMinutes ?? 0)}</dd>
                </div>
                <div className="side-info-item">
                  <dt>Started</dt>
                  <dd>{formatDate(meta.createdAt ?? '')}</dd>
                </div>
                {meta.permissionMode && (
                  <div className="side-info-item">
                    <dt>Permission</dt>
                    <dd>
                      {isPlanMode ? (
                        <span className="playback-badge playback-badge--plan-mode">計画モード</span>
                      ) : (
                        meta.permissionMode
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            {/* Tool Summary */}
            <section className="side-section">
              <h3 className="side-section-title">
                Tool Summary <span className="side-section-count">({totalToolCalls})</span>
              </h3>
              <div className="tool-summary-list">
                {toolCounts.map(([name, count]) => {
                  const pct = totalToolCalls > 0 ? (count / totalToolCalls) * 100 : 0
                  return (
                    <div key={name} className="tool-summary-item">
                      <div className="tool-summary-label">
                        <span className="tool-summary-name">{name}</span>
                        <span className="tool-summary-count">{count}</span>
                      </div>
                      <div className="tool-summary-bar-bg">
                        <div
                          className="tool-summary-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Files Edited */}
            {filesEdited.length > 0 && (
              <section className="side-section">
                <h3 className="side-section-title">
                  Files Edited <span className="side-section-count">({filesEdited.length})</span>
                </h3>
                <ul className="files-list">
                  {filesEdited.map(f => (
                    <li key={f} className="file-item">{f}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
