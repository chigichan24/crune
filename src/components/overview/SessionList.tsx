import { useState, useMemo } from 'react'
import type { SessionSummary, ProjectSummary } from '../../types'
import './SessionList.css'

interface Props {
  sessions: SessionSummary[]
  projects: ProjectSummary[]
  onSessionSelect: (sessionId: string) => void
}

type SortKey = 'date' | 'duration' | 'tools'

const PAGE_SIZE = 20

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

export function SessionList({ sessions, projects, onSessionSelect }: Props) {
  const [projectFilter, setProjectFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    let result = sessions.filter((s) => (s.turnCount ?? 0) > 0)

    if (projectFilter) {
      result = result.filter((s) => s.project === projectFilter)
    }

    if (branchFilter) {
      const q = branchFilter.toLowerCase()
      result = result.filter((s) => s.gitBranch?.toLowerCase().includes(q))
    }

    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((s) => new Date(s.createdAt) >= from)
    }

    if (dateTo) {
      const to = new Date(dateTo)
      to.setDate(to.getDate() + 1) // inclusive
      result = result.filter((s) => new Date(s.createdAt) < to)
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.firstUserPrompt.toLowerCase().includes(q))
    }

    result.sort((a, b) => {
      switch (sortKey) {
        case 'date':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'duration':
          return b.durationMinutes - a.durationMinutes
        case 'tools': {
          const aTools = a.toolCallCount ?? Object.values(a.toolBreakdown ?? {}).reduce((x: number, y: number) => x + y, 0)
          const bTools = b.toolCallCount ?? Object.values(b.toolBreakdown ?? {}).reduce((x: number, y: number) => x + y, 0)
          return bTools - aTools
        }
      }
    })

    return result
  }, [sessions, projectFilter, branchFilter, dateFrom, dateTo, searchQuery, sortKey])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const handleSortToggle = (key: SortKey) => {
    setSortKey(key)
    setPage(0)
  }

  return (
    <div className="session-list">
      <div className="session-list-filters">
        <select
          className="session-list-select"
          value={projectFilter}
          onChange={(e) => { setProjectFilter(e.target.value); setPage(0) }}
        >
          <option value="">All Projects</option>
          {projects.map((p) => {
            const name = p.name
            return (
            <option key={name} value={name}>
              {name}
            </option>
            )
          })}
        </select>

        <input
          className="session-list-input"
          type="text"
          placeholder="ブランチで絞り込み..."
          value={branchFilter}
          onChange={(e) => { setBranchFilter(e.target.value); setPage(0) }}
        />

        <input
          className="session-list-input session-list-input--date"
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
        />

        <input
          className="session-list-input session-list-input--date"
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
        />

        <input
          className="session-list-input session-list-input--search"
          type="text"
          placeholder="プロンプトを検索..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
        />
      </div>

      <div className="session-list-sort">
        並べ替え:
        {(['date', 'duration', 'tools'] as const).map((key) => (
          <button
            key={key}
            className={`session-list-sort-btn ${sortKey === key ? 'active' : ''}`}
            onClick={() => handleSortToggle(key)}
          >
            {key === 'date' ? 'Date' : key === 'duration' ? 'Duration' : 'Tool Calls'}
          </button>
        ))}
      </div>

      <div className="session-list-table-wrapper">
        <table className="session-list-table">
          <thead>
            <tr>
              <th className="session-list-th">Date</th>
              <th className="session-list-th">Project</th>
              <th className="session-list-th">Branch</th>
              <th className="session-list-th session-list-th--right">Duration</th>
              <th className="session-list-th session-list-th--right">Tools</th>
              <th className="session-list-th">First Prompt</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td className="session-list-td session-list-empty" colSpan={6}>
                  現在のフィルターに一致するセッションがありません
                </td>
              </tr>
            ) : (
              paged.map((s) => (
                <tr
                  key={s.sessionId}
                  className="session-list-row"
                  onClick={() => onSessionSelect(s.sessionId)}
                >
                  <td className="session-list-td session-list-td--date">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="session-list-td session-list-td--project">
                    {s.project}
                  </td>
                  <td className="session-list-td session-list-td--branch">
                    {s.gitBranch || '-'}
                  </td>
                  <td className="session-list-td session-list-td--right">
                    {formatDuration(s.durationMinutes)}
                  </td>
                  <td className="session-list-td session-list-td--right">
                    {s.toolCallCount ?? Object.values(s.toolBreakdown ?? {}).reduce((a: number, b: number) => a + b, 0)}
                  </td>
                  <td className="session-list-td session-list-td--prompt">
                    {truncate(s.firstUserPrompt, 80)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="session-list-pagination">
          <button
            className="session-list-page-btn"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Prev
          </button>
          <span className="session-list-page-info">
            {currentPage + 1} / {totalPages} ページ（{filtered.length} セッション）
          </span>
          <button
            className="session-list-page-btn"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
