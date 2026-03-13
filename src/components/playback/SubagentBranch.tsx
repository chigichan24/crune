import { useState } from 'react'
import type { SubagentSession } from '../../types/index.ts'
import { PlaybackStep } from './PlaybackStep.tsx'
import './SubagentBranch.css'

interface Props {
  agentId: string
  session: SubagentSession
}

export function SubagentBranch({ agentId, session }: Props) {
  const [expanded, setExpanded] = useState(false)

  const toolSummary = Object.entries(session.toolBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ')

  return (
    <div className="subagent-branch">
      <button
        className="subagent-toggle"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="subagent-icon">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="subagent-summary">
          Subagent {agentId.slice(0, 8)}
          {session.model && <span className="subagent-model"> ({session.model})</span>}
          <span className="subagent-stats">
            {' \u2014 '}{session.turns.length} turns, {session.toolCallCount} tool calls
          </span>
        </span>
      </button>
      {!expanded && toolSummary && (
        <div className="subagent-tool-summary">{toolSummary}</div>
      )}
      {expanded && (
        <div className="subagent-turns">
          {session.turns.map(turn => (
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
