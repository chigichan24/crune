import { useState } from 'react'
import type { ToolCall, SubagentSession } from '../../types'
import { SubagentBranch } from './SubagentBranch'
import { countLines, getToolCategory, shouldCollapse, truncate } from './toolCallHelpers'
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

/**
 * Extract the primary "code body" of a tool input for collapse-detection,
 * e.g. a Bash command (find/grep/ls -R bodies live here) or a search pattern.
 * Returns null when the tool has no large code-like body.
 */
function extractInputBody(name: string, input: Record<string, unknown>): string | null {
  const pick = (key: string): string | null =>
    typeof input[key] === 'string' ? (input[key] as string) : null
  switch (name) {
    case 'Bash':
      return pick('command')
    case 'Grep':
    case 'Glob':
      return pick('pattern')
    default:
      return null
  }
}

export function ToolCallBlock({ toolCall, subagents }: Props) {
  const name = toolCall.toolName ?? ''
  const input = toolCall.input ?? {}
  const result = toolCall.result ?? null
  const category = getToolCategory(name)
  const resultStr =
    result == null ? '' : typeof result === 'string' ? result : JSON.stringify(result)
  const isLongResult = shouldCollapse(resultStr)
  const [resultOpen, setResultOpen] = useState(!isLongResult)

  const inputBody = extractInputBody(name, input)
  const isLongInput = inputBody != null && shouldCollapse(inputBody)
  const [inputOpen, setInputOpen] = useState(!isLongInput)

  const subagentId = toolCall.subagentId ?? null
  const matchingSubagent = subagentId ? subagents[subagentId] : null

  const inputView = renderToolInput(name, input)

  const renderInput = () => {
    if (!isLongInput) return inputView
    return (
      <div className="tool-input-collapsible">
        <button
          className="tool-result-toggle"
          onClick={() => setInputOpen(prev => !prev)}
        >
          入力を{inputOpen ? '非表示' : '表示'}（{countLines(inputBody!)}行）
        </button>
        {inputOpen && inputView}
      </div>
    )
  }

  const renderResult = () => {
    if (!resultStr) return null

    return (
      <div className="tool-result">
        <button
          className="tool-result-toggle"
          onClick={() => setResultOpen(prev => !prev)}
        >
          結果を{resultOpen ? '非表示' : '表示'}（{countLines(resultStr)}行）
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
