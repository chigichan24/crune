import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSessionDetail } from '../../hooks/useSessionDetail.ts'
import type { ConversationTurn, ToolCall } from '../../types'
import { PlaybackStep } from './PlaybackStep.tsx'
import { PlaybackSidePanel } from './PlaybackSidePanel.tsx'
import { PlanModeContext } from './PlanModeContext.ts'
import { FeedbackContext } from './feedback/FeedbackContext.ts'
import { FeedbackCluster } from './feedback/FeedbackCluster.tsx'
import { useSessionFeedback } from '../../hooks/useSessionFeedback.ts'
import { selectKeyMoments, turnMatchesFilter } from './toolCallHelpers.ts'
import type { PlaybackFilter } from './toolCallHelpers.ts'
import './SessionPlayback.css'

interface Props {
  sessionId: string | null
  /** Turn to open at (e.g. a semantic-search hit). Defaults to the top. */
  initialTurnIndex?: number
  /** Open a different session/turn (e.g. a "似た瞬間" result). */
  onNavigate?: (sessionId: string, turnIndex: number) => void
  onClose: () => void
}

/** Build the semantic-search query text for a turn (mirrors the index input). */
function turnQueryText(turn: ConversationTurn): string {
  return [turn.userPrompt ?? '', ...(turn.assistantTexts ?? [])]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

type DotColor = 'blue' | 'orange' | 'green'

function getDotColor(turn: ConversationTurn): DotColor {
  const toolCalls = turn.toolCalls ?? []
  const hasAgent = toolCalls.some((tc: ToolCall) => tc.toolName === 'Agent')
  if (hasAgent) return 'green'

  const hasPlanTool = toolCalls.some(
    (tc: ToolCall) =>
      tc.toolName === 'EnterPlanMode' ||
      tc.toolName === 'ExitPlanMode' ||
      tc.toolName === 'TaskCreate' ||
      tc.toolName === 'TaskUpdate'
  )
  if (hasPlanTool) return 'orange'

  return 'blue'
}

const DOT_COLOR_MAP: Record<DotColor, string> = {
  blue: 'var(--chart-1)',
  orange: 'var(--chart-3)',
  green: 'var(--chart-2)',
}

const LEGEND_ITEMS: Array<{ color: DotColor; label: string; description: string }> = [
  { color: 'blue', label: 'Standard', description: 'コード編集、ファイル読み取り、シェルコマンド' },
  { color: 'orange', label: 'Planning', description: 'Planモードまたはタスク管理のターン' },
  { color: 'green', label: 'Agent', description: 'サブエージェントを生成して並列作業' },
]

function summarizeTurn(turn: ConversationTurn): string {
  const toolCalls = turn.toolCalls ?? []
  const color = getDotColor(turn)
  const category = LEGEND_ITEMS.find(l => l.color === color)
  const prompt = (turn.userPrompt ?? '').slice(0, 80)
  const toolNames = [...new Set(toolCalls.map((tc: ToolCall) => tc.toolName))].join(', ')
  const lines = [
    `Turn ${(turn.turnIndex ?? 0) + 1} — ${category?.label ?? 'Standard'}`,
    prompt ? `"${prompt}${(turn.userPrompt ?? '').length > 80 ? '...' : ''}"` : '',
    toolCalls.length > 0 ? `Tools (${toolCalls.length}): ${toolNames}` : 'ツール呼び出しなし',
  ]
  return lines.filter(Boolean).join('\n')
}

export function SessionPlayback({ sessionId, initialTurnIndex, onNavigate, onClose }: Props) {
  const { data, loading, error } = useSessionDetail(sessionId)
  const feedback = useSessionFeedback(sessionId)
  const [activeTurnIndex, setActiveTurnIndex] = useState(initialTurnIndex ?? 0)
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const contentRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [hoveredBar, setHoveredBar] = useState<{ index: number; x: number; y: number } | null>(null)
  const [filter, setFilter] = useState<PlaybackFilter>({ text: '', toolName: '', keyTurnsOnly: false })

  // Turn measurements for minimap
  const [turnMeasurements, setTurnMeasurements] = useState<Array<{ top: number; height: number }>>([])
  const [scrollInfo, setScrollInfo] = useState({ top: 0, height: 1, client: 1 })

  // Reset active turn when session changes. Honor a deep-link target turn (e.g.
  // a semantic-search hit) so the drawer opens focused on the matched turn.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state on prop change is intentional
    setActiveTurnIndex(initialTurnIndex ?? 0)
    setFilter({ text: '', toolName: '', keyTurnsOnly: false })
  }, [sessionId, initialTurnIndex])

  // After the session detail loads, scroll the deep-link target turn into view.
  // (The active-turn scroll effect only fires on index *changes*; a fresh load
  // that lands on the same index needs an explicit scroll once refs exist.)
  useEffect(() => {
    if (!data || initialTurnIndex == null) return
    const raf = requestAnimationFrame(() => {
      const el = turnRefs.current.get(initialTurnIndex)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [data, initialTurnIndex])

  // Measure turn positions after render
  useEffect(() => {
    if (!data) return
    const raf = requestAnimationFrame(() => {
      const measurements: Array<{ top: number; height: number }> = []
      for (let i = 0; i < data.turns.length; i++) {
        const el = turnRefs.current.get(i)
        if (el) {
          measurements.push({ top: el.offsetTop, height: el.offsetHeight })
        }
      }
      setTurnMeasurements(measurements)
    })
    return () => cancelAnimationFrame(raf)
  }, [data])

  // Track content scroll position
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = () => {
      setScrollInfo({
        top: el.scrollTop,
        height: el.scrollHeight || 1,
        client: el.clientHeight || 1,
      })
    }
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(() => {
      update()
      // Re-measure turns on resize
      const measurements: Array<{ top: number; height: number }> = []
      turnRefs.current.forEach((turnEl, i) => {
        measurements[i] = { top: turnEl.offsetTop, height: turnEl.offsetHeight }
      })
      setTurnMeasurements(measurements)
    })
    ro.observe(el)
    update()
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [data])

  // Scroll active turn into view (skip while dragging minimap)
  useEffect(() => {
    if (isDragging.current) return
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

  // Jump to a turn from the key-moments rail: activate it and scroll into view.
  const jumpToTurn = useCallback((index: number) => {
    setActiveTurnIndex(index)
    const el = turnRefs.current.get(index)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const setTurnRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      turnRefs.current.set(index, el)
    } else {
      turnRefs.current.delete(index)
    }
  }, [])

  // Minimap: click to jump
  const handleMinimapClick = useCallback((e: React.MouseEvent) => {
    const minimap = minimapRef.current
    const content = contentRef.current
    if (!minimap || !content) return
    const rect = minimap.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = y / rect.height
    const targetScroll = ratio * content.scrollHeight - content.clientHeight / 2
    content.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
  }, [])

  // Minimap: drag viewport indicator
  const handleViewportMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    isDragging.current = true
    const minimap = minimapRef.current
    const content = contentRef.current
    if (!minimap || !content) return

    const minimapRect = minimap.getBoundingClientRect()
    const startY = e.clientY
    const startScroll = content.scrollTop
    const scrollRange = content.scrollHeight - content.clientHeight

    const onMouseMove = (me: MouseEvent) => {
      const dy = me.clientY - startY
      const scrollDelta = (dy / minimapRect.height) * (scrollRange + content.clientHeight)
      content.scrollTop = startScroll + scrollDelta
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  // Compute minimap bar positions (percentage-based)
  const minimapBars = useMemo(() => {
    if (turnMeasurements.length === 0 || !data) return []
    const totalH = scrollInfo.height
    return turnMeasurements.map((m, i) => ({
      topPct: (m.top / totalH) * 100,
      heightPct: Math.max((m.height / totalH) * 100, 0.5),
      color: getDotColor(data.turns[i]),
      index: i,
    }))
  }, [turnMeasurements, scrollInfo.height, data])

  // Semantic key-moments for the jump-link rail
  const keyMoments = useMemo(
    () => (data ? selectKeyMoments(data.turns) : []),
    [data],
  )
  const keyIndices = useMemo(
    () => new Set(keyMoments.map(m => m.index)),
    [keyMoments],
  )

  // Distinct tool names present in the session, for the tool-name filter dropdown
  const availableToolNames = useMemo(() => {
    if (!data) return []
    const names = new Set<string>()
    for (const turn of data.turns) {
      for (const tc of turn.toolCalls ?? []) {
        if (tc.toolName) names.add(tc.toolName)
      }
    }
    return [...names].sort()
  }, [data])

  // Set of turn indices that pass the active filter
  const isFilterActive =
    filter.text.trim() !== '' || filter.toolName !== '' || filter.keyTurnsOnly
  const matchedIndices = useMemo(() => {
    if (!data) return new Set<number>()
    const matched = new Set<number>()
    data.turns.forEach((turn, i) => {
      if (turnMatchesFilter(turn, i, filter, keyIndices)) matched.add(i)
    })
    return matched
  }, [data, filter, keyIndices])

  // Viewport indicator position
  const viewportTopPct = (scrollInfo.top / scrollInfo.height) * 100
  const viewportHeightPct = (scrollInfo.client / scrollInfo.height) * 100

  if (!sessionId) {
    return null
  }

  if (loading) {
    return <div className="playback-loading">セッションを読み込み中...</div>
  }

  if (error) {
    return <div className="playback-error">エラー: {error}</div>
  }

  if (!data) {
    return <div className="playback-empty">セッションデータがありません</div>
  }

  const { meta, turns, subagents } = data
  const isPlanMode = meta.permissionMode === 'plan'

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return `${h}h ${m}m`
  }

  return (
    <PlanModeContext.Provider value={isPlanMode}>
      <FeedbackContext.Provider value={feedback}>
      <div className="session-playback">
      <div className="playback-header">
        <div className="playback-header-info">
          <h2 className="playback-project">{meta.project}</h2>
          <div className="playback-meta-row">
            {meta.branch && (
              <span className="playback-badge playback-badge--branch">
                {meta.branch}
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
            {isPlanMode && (
              <span className="playback-badge playback-badge--plan-mode">計画モード</span>
            )}
          </div>
        </div>
        <button className="playback-close-button" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Color legend */}
      <div className="playback-legend">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.color} className="legend-item" title={item.description}>
            <span
              className="legend-dot"
              style={{ backgroundColor: DOT_COLOR_MAP[item.color] }}
            />
            <span className="legend-label">{item.label}</span>
            <span className="legend-desc">{item.description}</span>
          </div>
        ))}
      </div>

      {/* Key-moments rail: labeled jump links to semantically important turns */}
      {keyMoments.length > 0 && (
        <div className="playback-keymoments" role="navigation" aria-label="重要な瞬間">
          <span className="keymoments-label">重要な瞬間</span>
          <div className="keymoments-links">
            {keyMoments.map((moment) => (
              <button
                key={moment.index}
                className={`keymoment-link keymoment-link--${moment.kind} ${moment.index === activeTurnIndex ? 'keymoment-link--active' : ''}`}
                title={summarizeTurn(turns[moment.index])}
                onClick={() => jumpToTurn(moment.index)}
              >
                <span className="keymoment-kind">{moment.label}</span>
                <span className="keymoment-index">#{moment.index + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search / filter bar */}
      <div className="playback-filter">
        <input
          type="text"
          className="filter-text"
          placeholder="ターンを検索（プロンプト・応答・ツール名）"
          value={filter.text}
          onChange={e => setFilter(f => ({ ...f, text: e.target.value }))}
        />
        <select
          className="filter-tool"
          value={filter.toolName}
          onChange={e => setFilter(f => ({ ...f, toolName: e.target.value }))}
        >
          <option value="">すべてのツール</option>
          {availableToolNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <label className="filter-keyturns">
          <input
            type="checkbox"
            checked={filter.keyTurnsOnly}
            onChange={e => setFilter(f => ({ ...f, keyTurnsOnly: e.target.checked }))}
          />
          重要なターンのみ
        </label>
        {isFilterActive && (
          <span className="filter-count">一致: {matchedIndices.size}</span>
        )}
        {isFilterActive && (
          <button
            className="filter-clear"
            onClick={() => setFilter({ text: '', toolName: '', keyTurnsOnly: false })}
          >
            クリア
          </button>
        )}
      </div>

      <div className="playback-body">
        {/* Minimap */}
        <div
          ref={minimapRef}
          className="playback-minimap"
          onClick={handleMinimapClick}
        >
          <div className="minimap-bars">
            {minimapBars.map((bar) => (
              <div
                key={bar.index}
                className={`minimap-bar ${bar.index === activeTurnIndex ? 'minimap-bar--active' : ''}`}
                style={{
                  top: `${bar.topPct}%`,
                  height: `${bar.heightPct}%`,
                  backgroundColor: DOT_COLOR_MAP[bar.color],
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoveredBar({ index: bar.index, x: rect.right + 8, y: rect.top })
                }}
                onMouseLeave={() => setHoveredBar(null)}
              />
            ))}
          </div>
          <div
            className="minimap-viewport"
            style={{
              top: `${viewportTopPct}%`,
              height: `${Math.min(viewportHeightPct, 100)}%`,
            }}
            onMouseDown={handleViewportMouseDown}
          />
        </div>

        {/* Minimap hover tooltip */}
        {hoveredBar && (
          <div
            className="minimap-tooltip"
            style={{ top: hoveredBar.y, left: hoveredBar.x }}
          >
            {summarizeTurn(turns[hoveredBar.index]).split('\n').map((line, i) => (
              <div key={i} className={i === 0 ? 'minimap-tooltip-title' : 'minimap-tooltip-line'}>
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Turn content */}
        <div ref={contentRef} className="playback-content">
          {turns.map((turn, i) => {
            // Non-matching turns are dimmed + collapsed in place but kept in the
            // DOM so minimap/keyboard-nav indices stay valid.
            const dimmed = isFilterActive && !matchedIndices.has(i)
            return (
              <div
                key={turn.turnIndex}
                className={`playback-turn ${i === activeTurnIndex ? 'playback-turn--active' : ''}${dimmed ? ' playback-turn--filtered' : ''}`}
                ref={el => setTurnRef(i, el)}
                onClick={() => setActiveTurnIndex(i)}
              >
                {dimmed ? (
                  <div className="playback-turn-collapsed">
                    <span className="collapsed-index">#{i + 1}</span>
                    <span className="collapsed-prompt">
                      {(turn.userPrompt ?? '').slice(0, 80) || '（プロンプトなし）'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="playback-turn-feedback">
                      <FeedbackCluster
                        turnId={turn.turnIndex}
                        similar={
                          onNavigate && sessionId
                            ? {
                                queryText: turnQueryText(turn),
                                sessionId,
                                onSelect: onNavigate,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <PlaybackStep
                      turn={turn}
                      isActive={i === activeTurnIndex}
                      subagents={subagents}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>

        <PlaybackSidePanel detail={data} />
      </div>
      </div>
      </FeedbackContext.Provider>
    </PlanModeContext.Provider>
  )
}
