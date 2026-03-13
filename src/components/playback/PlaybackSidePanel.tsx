import { useMemo } from 'react'
import type { SessionDetail } from '../../types/index.ts'
import './PlaybackSidePanel.css'

interface Props {
  detail: SessionDetail
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
  const { meta, turns, linkedPlan } = detail

  // Compute tool breakdown from turns
  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const turn of turns) {
      for (const block of turn.assistantBlocks) {
        if (block.type === 'tool_use') {
          counts[block.name] = (counts[block.name] ?? 0) + 1
        }
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [turns])

  const totalToolCalls = toolCounts.reduce((sum, [, c]) => sum + c, 0)

  // Extract files edited from Edit/Write tool calls
  const filesEdited = useMemo(() => {
    const files = new Set<string>()
    for (const turn of turns) {
      for (const block of turn.assistantBlocks) {
        if (
          block.type === 'tool_use' &&
          (block.name === 'Edit' || block.name === 'Write') &&
          block.input.file_path
        ) {
          files.add(block.input.file_path)
        }
      }
    }
    return Array.from(files).sort()
  }, [turns])

  return (
    <aside className="playback-side-panel">
      {/* Session Info */}
      <section className="side-section">
        <h3 className="side-section-title">Session Info</h3>
        <dl className="side-info-list">
          <div className="side-info-item">
            <dt>Project</dt>
            <dd>{meta.project}</dd>
          </div>
          {meta.gitBranch && (
            <div className="side-info-item">
              <dt>Branch</dt>
              <dd>{meta.gitBranch}</dd>
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
            <dd>{formatDuration(meta.durationMinutes)}</dd>
          </div>
          <div className="side-info-item">
            <dt>Started</dt>
            <dd>{formatDate(meta.createdAt)}</dd>
          </div>
          {meta.permissionMode && (
            <div className="side-info-item">
              <dt>Permission</dt>
              <dd>{meta.permissionMode}</dd>
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

      {/* Linked Plan */}
      {linkedPlan && (
        <section className="side-section">
          <h3 className="side-section-title">Linked Plan</h3>
          <div className="linked-plan-slug">{linkedPlan.slug}</div>
          <pre className="linked-plan-content">{linkedPlan.content}</pre>
        </section>
      )}
    </aside>
  )
}
