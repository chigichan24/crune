import { useState } from 'react'
import type { ToolCall, SubagentSession } from '../../types'
import { SubagentBranch } from './SubagentBranch'
import './ToolCallBlock.css'

interface Props {
  toolCall: ToolCall
  subagents: Record<string, SubagentSession>
}

type ToolCategory = 'shell' | 'edit' | 'read' | 'search' | 'agent' | 'other'

function getToolCategory(name: string): ToolCategory {
  switch (name) {
    case 'Bash':
      return 'shell'
    case 'Edit':
    case 'Write':
      return 'edit'
    case 'Read':
      return 'read'
    case 'Grep':
    case 'Glob':
      return 'search'
    case 'Agent':
      return 'agent'
    default:
      return 'other'
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

export function ToolCallBlock({ toolCall, subagents }: Props) {
  const name = toolCall.toolName ?? ''
  const input = toolCall.input ?? {}
  const result = toolCall.result ?? null
  const category = getToolCategory(name)
  const isLongResult = typeof result === 'string' && result.length > 500
  const [resultOpen, setResultOpen] = useState(!isLongResult)

  // Find matching subagent
  const subagentId = toolCall.subagentId ?? null
  const matchingSubagent = subagentId ? subagents[subagentId] : null

  const renderInput = () => {
    switch (name) {
      case 'Bash':
        return (
          <div className="tool-input">
            {input.description != null && (
              <div className="tool-subtitle">{String(input.description)}</div>
            )}
            {input.command != null && (
              <pre className="tool-code-block">{String(input.command)}</pre>
            )}
          </div>
        )

      case 'Edit':
        return (
          <div className="tool-input">
            {input.file_path != null && (
              <div className="tool-file-path">{String(input.file_path)}</div>
            )}
            {input.old_string != null && (
              <pre className="tool-diff tool-diff--old">{String(input.old_string)}</pre>
            )}
            {input.new_string != null && (
              <pre className="tool-diff tool-diff--new">{String(input.new_string)}</pre>
            )}
          </div>
        )

      case 'Write':
        return (
          <div className="tool-input">
            {input.file_path != null && (
              <div className="tool-file-path">{String(input.file_path)}</div>
            )}
            {input.content != null && (
              <pre className="tool-code-block">
                {truncate(String(input.content), 300)}
              </pre>
            )}
            {input.contentLength != null && (
              <div className="tool-content-length">
                合計 {String(input.contentLength)} 文字
              </div>
            )}
          </div>
        )

      case 'Read':
        return (
          <div className="tool-input">
            {input.file_path != null && (
              <div className="tool-file-path">{String(input.file_path)}</div>
            )}
          </div>
        )

      case 'Grep':
      case 'Glob':
        return (
          <div className="tool-input">
            {input.pattern != null && (
              <code className="tool-pattern">{String(input.pattern)}</code>
            )}
            {typeof input.path === 'string' && input.path && (
              <span className="tool-search-path"> in {input.path}</span>
            )}
          </div>
        )

      case 'Agent':
        return (
          <div className="tool-input">
            {(input.prompt != null || input.description != null) && (
              <div className="tool-subtitle">
                {String(input.prompt ?? input.description)}
              </div>
            )}
            {input.subagent_type != null && (
              <span className="tool-agent-type">{String(input.subagent_type)}</span>
            )}
          </div>
        )

      default: {
        const displayKeys = Object.keys(input).filter(
          k => input[k] != null && typeof input[k] !== 'object'
        )
        if (displayKeys.length === 0) return null
        const display: Record<string, unknown> = {}
        for (const k of displayKeys.slice(0, 5)) {
          display[k] = input[k]
        }
        return (
          <div className="tool-input">
            <pre className="tool-code-block">
              {JSON.stringify(display, null, 2)}
            </pre>
          </div>
        )
      }
    }
  }

  const renderResult = () => {
    if (!result) return null
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
    if (!resultStr) return null

    return (
      <div className="tool-result">
        <button
          className="tool-result-toggle"
          onClick={() => setResultOpen(prev => !prev)}
        >
          結果を{resultOpen ? '非表示' : '表示'}
        </button>
        {resultOpen && (
          <pre className="tool-result-content">{truncate(resultStr, 2000)}</pre>
        )}
      </div>
    )
  }

  return (
    <div className={`tool-call-block tool-call-block--${category}`}>
      <div className="tool-call-header">
        <span className={`tool-name-badge tool-name-badge--${category}`}>
          {name}
        </span>
      </div>
      {renderInput()}
      {renderResult()}
      {name === 'Agent' && matchingSubagent && (
        <SubagentBranch
          agentId={subagentId!}
          session={matchingSubagent}
        />
      )}
    </div>
  )
}
