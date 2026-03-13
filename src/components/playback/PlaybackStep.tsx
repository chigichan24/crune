import { useState } from 'react'
import { ToolCallBlock } from './ToolCallBlock'
import './PlaybackStep.css'

interface Props {
  turn: any
  isActive: boolean
  subagents: Record<string, any>
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function PlaybackStep({ turn, isActive, subagents }: Props) {
  const [thinkingOpen, setThinkingOpen] = useState(false)

  const toolCalls = turn.toolCalls ?? []
  const assistantTexts = turn.assistantTexts ?? []
  const assistantThinking = turn.assistantThinking ?? null

  return (
    <div className={`playback-step ${isActive ? 'playback-step--active' : ''}`}>
      {/* User prompt */}
      <div className="step-user">
        <div className="step-role-label step-role-label--user">User</div>
        <span className="step-timestamp">{formatTimestamp(turn.timestamp)}</span>
        <div className="step-user-text">{turn.userPrompt}</div>
      </div>

      {/* Thinking */}
      {assistantThinking && (
        <div className="step-thinking">
          <button
            className="step-thinking-toggle"
            onClick={() => setThinkingOpen(prev => !prev)}
          >
            {thinkingOpen ? 'Hide' : 'Show'} thinking
          </button>
          {thinkingOpen && (
            <pre className="step-thinking-text">{assistantThinking}</pre>
          )}
        </div>
      )}

      {/* Text blocks */}
      {assistantTexts.map((text: string, i: number) => (
        <div key={i} className="step-text">
          <pre className="step-text-content">{text}</pre>
        </div>
      ))}

      {/* Tool calls */}
      {toolCalls.map((tc: any) => (
        <ToolCallBlock
          key={tc.toolUseId}
          toolCall={tc}
          subagents={subagents}
        />
      ))}
    </div>
  )
}
