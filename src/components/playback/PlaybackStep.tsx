import { useState } from 'react'
import type { ConversationTurn, SubagentSession } from '../../types/index.ts'
import { ToolCallBlock } from './ToolCallBlock.tsx'
import './PlaybackStep.css'

interface Props {
  turn: ConversationTurn
  isActive: boolean
  subagents: Record<string, SubagentSession>
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function PlaybackStep({ turn, isActive, subagents }: Props) {
  const [thinkingOpen, setThinkingOpen] = useState(false)

  return (
    <div className={`playback-step ${isActive ? 'playback-step--active' : ''}`}>
      {/* User prompt */}
      <div className="step-user">
        <div className="step-role-label step-role-label--user">User</div>
        <span className="step-timestamp">{formatTimestamp(turn.timestamp)}</span>
        <div className="step-user-text">{turn.userPrompt}</div>
      </div>

      {/* Assistant blocks */}
      <div className="step-assistant-blocks">
        {turn.assistantBlocks.map((block, i) => {
          switch (block.type) {
            case 'thinking':
              return (
                <div key={i} className="step-thinking">
                  <button
                    className="step-thinking-toggle"
                    onClick={() => setThinkingOpen(prev => !prev)}
                  >
                    {thinkingOpen ? 'Hide' : 'Show'} thinking
                    {block.truncated && ' (truncated)'}
                  </button>
                  {thinkingOpen && (
                    <pre className="step-thinking-text">{block.thinking}</pre>
                  )}
                </div>
              )

            case 'text':
              return (
                <div key={i} className="step-text">
                  <pre className="step-text-content">{block.text}</pre>
                </div>
              )

            case 'tool_use':
              return (
                <ToolCallBlock
                  key={block.id}
                  block={block}
                  subagents={subagents}
                />
              )

            default:
              return null
          }
        })}
      </div>
    </div>
  )
}
