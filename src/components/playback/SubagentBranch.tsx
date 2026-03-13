import type { SubagentSession } from '../../types/index.ts'
import './SubagentBranch.css'

interface Props {
  agentId: string
  session: SubagentSession
}

export function SubagentBranch({ agentId, session }: Props) {
  return (
    <div className="subagent-branch">
      <div className="subagent-placeholder">
        Subagent {agentId} - {session.turns.length} turns (implementation pending)
      </div>
    </div>
  )
}
