import { useState } from 'react'
import type { ToolUseBlock, SubagentSession } from '../../types/index.ts'
import { SubagentBranch } from './SubagentBranch.tsx'
import './ToolCallBlock.css'

interface Props {
  block: ToolUseBlock
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

export function ToolCallBlock({ block, subagents }: Props) {
  const { name, input, result, subagentId } = block
  const category = getToolCategory(name)
  const isLongResult = (result?.content.length ?? 0) > 500
  const [resultOpen, setResultOpen] = useState(!isLongResult)

  const renderInput = () => {
    switch (name) {
      case 'Bash':
        return (
          <div className="tool-input">
            {input.description && (
              <div className="tool-subtitle">{input.description}</div>
            )}
            {input.command && (
              <pre className="tool-code-block">{input.command}</pre>
            )}
          </div>
        )

      case 'Edit':
        return (
          <div className="tool-input">
            {input.file_path && (
              <div className="tool-file-path">{input.file_path}</div>
            )}
            {input.old_string != null && (
              <pre className="tool-diff tool-diff--old">{input.old_string}</pre>
            )}
            {input.new_string != null && (
              <pre className="tool-diff tool-diff--new">{input.new_string}</pre>
            )}
          </div>
        )

      case 'Write':
        return (
          <div className="tool-input">
            {input.file_path && (
              <div className="tool-file-path">{input.file_path}</div>
            )}
            {input.content && (
              <pre className="tool-code-block">
                {truncate(input.content, 300)}
              </pre>
            )}
            {input.contentLength != null && (
              <div className="tool-content-length">
                {input.contentLength} chars total
              </div>
            )}
          </div>
        )

      case 'Read':
        return (
          <div className="tool-input">
            {input.file_path && (
              <div className="tool-file-path">{input.file_path}</div>
            )}
          </div>
        )

      case 'Grep':
      case 'Glob':
        return (
          <div className="tool-input">
            {input.pattern && (
              <code className="tool-pattern">{input.pattern}</code>
            )}
            {typeof input.path === 'string' && input.path && (
              <span className="tool-search-path"> in {input.path}</span>
            )}
          </div>
        )

      case 'Agent':
        return (
          <div className="tool-input">
            {(input.prompt || input.description) && (
              <div className="tool-subtitle">
                {(input.prompt || input.description) as string}
              </div>
            )}
            {input.subagent_type && (
              <span className="tool-agent-type">{input.subagent_type}</span>
            )}
          </div>
        )

      default: {
        // Show key input fields as JSON
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

    return (
      <div className={`tool-result ${result.isError ? 'tool-result--error' : ''}`}>
        <button
          className="tool-result-toggle"
          onClick={() => setResultOpen(prev => !prev)}
        >
          {resultOpen ? 'Hide' : 'Show'} result
          {result.truncated && ' (truncated)'}
          {result.isError && ' [ERROR]'}
        </button>
        {resultOpen && (
          <pre className="tool-result-content">{result.content}</pre>
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
      {name === 'Agent' && subagentId && subagents[subagentId] && (
        <SubagentBranch
          agentId={subagentId}
          session={subagents[subagentId]}
        />
      )}
    </div>
  )
}
