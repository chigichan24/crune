import { useState } from 'react'
import { PlaybackStep } from './PlaybackStep'
import { usePlanMode } from './PlanModeContext'
import './SubagentBranch.css'

interface Props {
  agentId: string
  session: any
}

export function SubagentBranch({ agentId, session }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isPlanMode = usePlanMode()

  const turns = session.turns ?? []
  const model = session.model ?? null
  const agentType = session.agentType ?? null

  // Compute tool counts from turns
  const toolCounts: Record<string, number> = {}
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      const name = tc.toolName ?? 'unknown'
      toolCounts[name] = (toolCounts[name] ?? 0) + 1
    }
  }

  const totalToolCalls = Object.values(toolCounts).reduce((a, b) => a + b, 0)
  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ')

  return (
    <div className={`subagent-branch${isPlanMode ? ' subagent-branch--plan' : ''}`}>
      <button
        className="subagent-toggle"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="subagent-icon">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="subagent-summary">
          {isPlanMode ? '探索エージェント' : 'Subagent'} {agentId.slice(0, 8)}
          {agentType && <span className="subagent-model"> [{agentType}]</span>}
          {model && <span className="subagent-model"> ({model})</span>}
          <span className="subagent-stats">
            {' \u2014 '}{turns.length} ターン、{totalToolCalls} ツール呼び出し
          </span>
        </span>
      </button>
      {!expanded && toolSummary && (
        <div className="subagent-tool-summary">{toolSummary}</div>
      )}
      {expanded && (
        <div className="subagent-turns">
          {turns.map((turn: any) => (
            <PlaybackStep
              key={turn.turnIndex}
              turn={turn}
              isActive={false}
              subagents={{}}
            />
          ))}
        </div>
      )}
    </div>
  )
}
