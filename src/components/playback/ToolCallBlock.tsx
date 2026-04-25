import { useState } from 'react'
import type { ToolCall, SubagentSession } from '../../types'
import { SubagentBranch } from './SubagentBranch'
import { getToolCategory, truncate } from './toolCallHelpers'
import {
  AgentRenderer,
  AskUserQuestionRenderer,
  BashRenderer,
  EditRenderer,
  EnterPlanModeRenderer,
  ExitPlanModeRenderer,
  GenericInputRenderer,
  GrepGlobRenderer,
  McpRenderer,
  MonitorRenderer,
  NotebookEditRenderer,
  ReadRenderer,
  ScheduleWakeupRenderer,
  SkillRenderer,
  TaskCreateRenderer,
  TaskUpdateRenderer,
  ToolSearchRenderer,
  WebFetchRenderer,
  WebSearchRenderer,
  WriteRenderer,
} from './ToolCallRenderers'
import './ToolCallBlock.css'

interface Props {
  toolCall: ToolCall
  subagents: Record<string, SubagentSession>
}

export function ToolCallBlock({ toolCall, subagents }: Props) {
  const name = toolCall.toolName ?? ''
  const input = toolCall.input ?? {}
  const result = toolCall.result ?? null
  const category = getToolCategory(name)
  const isLongResult = typeof result === 'string' && result.length > 500
  const [resultOpen, setResultOpen] = useState(!isLongResult)

  const subagentId = toolCall.subagentId ?? null
  const matchingSubagent = subagentId ? subagents[subagentId] : null

  const inputView = renderToolInput(name, input)

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
      {inputView}
      {renderResult()}
      {(name === 'Agent' || name === 'Task') && matchingSubagent && (
        <SubagentBranch
          agentId={subagentId!}
          session={matchingSubagent}
        />
      )}
    </div>
  )
}

function renderToolInput(name: string, input: Record<string, unknown>) {
  switch (name) {
    case 'Bash':
      return <BashRenderer input={input} />
    case 'Edit':
    case 'MultiEdit':
      return <EditRenderer input={input} />
    case 'Write':
      return <WriteRenderer input={input} />
    case 'Read':
      return <ReadRenderer input={input} />
    case 'Grep':
    case 'Glob':
      return <GrepGlobRenderer input={input} />
    case 'Agent':
    case 'Task':
      return <AgentRenderer input={input} />

    // Task tracking
    case 'TaskCreate':
      return <TaskCreateRenderer input={input} />
    case 'TaskUpdate':
      return <TaskUpdateRenderer input={input} />

    // Questions / skills
    case 'AskUserQuestion':
      return <AskUserQuestionRenderer input={input} />
    case 'Skill':
      return <SkillRenderer input={input} />
    case 'ToolSearch':
      return <ToolSearchRenderer input={input} />

    // Web
    case 'WebFetch':
      return <WebFetchRenderer input={input} />
    case 'WebSearch':
      return <WebSearchRenderer input={input} />

    // Notebook
    case 'NotebookEdit':
      return <NotebookEditRenderer input={input} />

    // Plan mode / worktree toggles
    case 'EnterPlanMode':
    case 'EnterWorktree':
      return <EnterPlanModeRenderer input={input} />
    case 'ExitPlanMode':
    case 'ExitWorktree':
      return <ExitPlanModeRenderer input={input} />

    // Monitor / ScheduleWakeup
    case 'Monitor':
      return <MonitorRenderer input={input} />
    case 'ScheduleWakeup':
      return <ScheduleWakeupRenderer input={input} />

    default:
      if (name.startsWith('mcp__')) {
        return <McpRenderer toolName={name} input={input} />
      }
      return <GenericInputRenderer input={input} />
  }
}
