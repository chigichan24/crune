/**
 * Per-tool input renderers used by ToolCallBlock.
 *
 * Each renderer receives the parsed `input` object for its tool and returns a
 * compact JSX summary. The renderers are intentionally small and focused so
 * the main ToolCallBlock component stays readable.
 */

import {
  parseMcpToolName,
  pickKeyInputArgs,
  summarizeValue,
  truncate,
} from './toolCallHelpers'

type Input = Record<string, unknown>

/**
 * Coerce a value to a string for display, but only for scalars. Objects and
 * arrays return null so callers can fall back to a structured renderer instead
 * of rendering "[object Object]" or "1,2,3" garbage.
 */
function asString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

// ─── Existing tools ─────────────────────────────────────────────────────────

export function BashRenderer({ input }: { input: Input }) {
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
}

export function EditRenderer({ input }: { input: Input }) {
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
}

export function WriteRenderer({ input }: { input: Input }) {
  return (
    <div className="tool-input">
      {input.file_path != null && (
        <div className="tool-file-path">{String(input.file_path)}</div>
      )}
      {input.content != null && (
        <pre className="tool-code-block">{truncate(String(input.content), 300)}</pre>
      )}
      {input.contentLength != null && (
        <div className="tool-content-length">
          合計 {String(input.contentLength)} 文字
        </div>
      )}
    </div>
  )
}

export function ReadRenderer({ input }: { input: Input }) {
  return (
    <div className="tool-input">
      {input.file_path != null && (
        <div className="tool-file-path">{String(input.file_path)}</div>
      )}
    </div>
  )
}

export function GrepGlobRenderer({ input }: { input: Input }) {
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
}

export function AgentRenderer({ input }: { input: Input }) {
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
}

// ─── Task tracking (TaskCreate / TaskUpdate / TaskList / etc.) ──────────────

export function TaskCreateRenderer({ input }: { input: Input }) {
  const subject = asString(input.subject)
  const description = asString(input.description)
  const activeForm = asString(input.activeForm)
  return (
    <div className="tool-input">
      {subject && <div className="tool-task-subject">{subject}</div>}
      {description && <div className="tool-subtitle">{truncate(description, 280)}</div>}
      {activeForm && (
        <div className="tool-task-activeform">
          <span className="tool-task-tag">進行中</span> {activeForm}
        </div>
      )}
    </div>
  )
}

export function TaskUpdateRenderer({ input }: { input: Input }) {
  const taskId = asString(input.taskId)
  const status = asString(input.status)
  const note = asString(input.note ?? input.description)
  return (
    <div className="tool-input">
      <div className="tool-task-row">
        {taskId && <span className="tool-task-id">#{taskId}</span>}
        {status && (
          <span className={`tool-task-status tool-task-status--${status}`}>
            {status}
          </span>
        )}
      </div>
      {note && <div className="tool-subtitle">{truncate(note, 280)}</div>}
    </div>
  )
}

// ─── AskUserQuestion ────────────────────────────────────────────────────────

interface AskQuestion {
  question?: string
  header?: string
  options?: { label?: string; description?: string }[]
  multiSelect?: boolean
}

export function AskUserQuestionRenderer({ input }: { input: Input }) {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : []
  const questions: AskQuestion[] = rawQuestions.filter(
    (q): q is AskQuestion => typeof q === 'object' && q !== null,
  )

  if (questions.length === 0) {
    // Fallback: maybe a single question payload
    const single = asString(input.question)
    if (!single) return null
    return (
      <div className="tool-input">
        <div className="tool-question-text">{truncate(single, 300)}</div>
      </div>
    )
  }

  return (
    <div className="tool-input">
      {questions.map((q, i) => {
        const header = typeof q.header === 'string' ? q.header : null
        const question = typeof q.question === 'string' ? q.question : null
        return (
        <div key={i} className="tool-question">
          {header && <div className="tool-question-header">{header}</div>}
          {question && (
            <div className="tool-question-text">{truncate(question, 280)}</div>
          )}
          {Array.isArray(q.options) && q.options.length > 0 && (() => {
            const safeOptions = q.options.filter(
              (opt): opt is { label?: string; description?: string } =>
                typeof opt === 'object' && opt !== null,
            )
            if (safeOptions.length === 0) return null
            return (
              <ul className="tool-question-options">
                {safeOptions.slice(0, 6).map((opt, j) => {
                  const label =
                    typeof opt.label === 'string' && opt.label.length > 0
                      ? opt.label
                      : `選択肢 ${j + 1}`
                  const description =
                    typeof opt.description === 'string' ? opt.description : null
                  return (
                    <li key={j} className="tool-question-option">
                      <span className="tool-question-option-label">{label}</span>
                      {description && (
                        <span className="tool-question-option-desc">
                          {' — '}{truncate(description, 160)}
                        </span>
                      )}
                    </li>
                  )
                })}
                {safeOptions.length > 6 && (
                  <li className="tool-question-option tool-question-option--more">
                    …他 {safeOptions.length - 6} 件
                  </li>
                )}
              </ul>
            )
          })()}
        </div>
        )
      })}
    </div>
  )
}

// ─── Skill ──────────────────────────────────────────────────────────────────

export function SkillRenderer({ input }: { input: Input }) {
  const skill = asString(input.skill ?? input.name)
  const args = asString(input.args ?? input.arguments)
  return (
    <div className="tool-input">
      {skill && <div className="tool-skill-name">/{skill}</div>}
      {args && <pre className="tool-code-block">{truncate(args, 240)}</pre>}
    </div>
  )
}

// ─── Web ────────────────────────────────────────────────────────────────────

export function WebFetchRenderer({ input }: { input: Input }) {
  const url = asString(input.url)
  const prompt = asString(input.prompt)
  return (
    <div className="tool-input">
      {url && (
        <div className="tool-url" title={url}>
          {truncate(url, 200)}
        </div>
      )}
      {prompt && <div className="tool-subtitle">{truncate(prompt, 280)}</div>}
    </div>
  )
}

function toStringDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((d): d is string => typeof d === 'string' && d.length > 0)
}

export function WebSearchRenderer({ input }: { input: Input }) {
  const query = asString(input.query)
  const allowed = toStringDomains(input.allowed_domains)
  const blocked = toStringDomains(input.blocked_domains)
  return (
    <div className="tool-input">
      {query && <div className="tool-query">{truncate(query, 240)}</div>}
      {allowed.length > 0 && (
        <div className="tool-web-domains">
          <span className="tool-web-domain-label">allow:</span>{' '}
          {allowed.slice(0, 5).join(', ')}
          {allowed.length > 5 && ` …+${allowed.length - 5}`}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="tool-web-domains">
          <span className="tool-web-domain-label">block:</span>{' '}
          {blocked.slice(0, 5).join(', ')}
          {blocked.length > 5 && ` …+${blocked.length - 5}`}
        </div>
      )}
    </div>
  )
}

// ─── NotebookEdit ───────────────────────────────────────────────────────────

export function NotebookEditRenderer({ input }: { input: Input }) {
  const notebookPath = asString(input.notebook_path ?? input.file_path)
  const cellId = asString(input.cell_id)
  const cellType = asString(input.cell_type)
  const editMode = asString(input.edit_mode)
  const newSource = asString(input.new_source)
  return (
    <div className="tool-input">
      {notebookPath && (
        <div className="tool-file-path">{notebookPath}</div>
      )}
      <div className="tool-task-row">
        {editMode && (
          <span className="tool-notebook-tag">{editMode}</span>
        )}
        {cellType && (
          <span className="tool-notebook-tag tool-notebook-tag--type">{cellType}</span>
        )}
        {cellId && (
          <span className="tool-task-id">cell:{truncate(cellId, 24)}</span>
        )}
      </div>
      {newSource && (
        <pre className="tool-code-block">{truncate(newSource, 300)}</pre>
      )}
    </div>
  )
}

// ─── Plan mode / worktree toggles ───────────────────────────────────────────

interface AllowedPrompt {
  tool?: string
  prompt?: string
}

export function ExitPlanModeRenderer({ input }: { input: Input }) {
  const plan = asString(input.plan)
  const allowed = Array.isArray(input.allowedPrompts)
    ? (input.allowedPrompts.filter(
        (p): p is AllowedPrompt => typeof p === 'object' && p !== null,
      ) as AllowedPrompt[])
    : []
  return (
    <div className="tool-input">
      {plan && (
        <pre className="tool-code-block tool-plan-block">
          {truncate(plan, 600)}
        </pre>
      )}
      {allowed.length > 0 && (
        <div className="tool-plan-allowed">
          <span className="tool-plan-allowed-label">許可 ({allowed.length})</span>
          <ul className="tool-plan-allowed-list">
            {allowed.slice(0, 5).map((p, i) => {
              const tool = typeof p.tool === 'string' ? p.tool : null
              const prompt = typeof p.prompt === 'string' ? p.prompt : null
              return (
                <li key={i}>
                  {tool && <span className="tool-task-tag">{tool}</span>}{' '}
                  {prompt && <span>{truncate(prompt, 120)}</span>}
                </li>
              )
            })}
            {allowed.length > 5 && <li>…他 {allowed.length - 5} 件</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

export function EnterPlanModeRenderer({ input }: { input: Input }) {
  // EnterPlanMode usually has empty input. Show any reason if present.
  const reason = asString(input.reason ?? input.message)
  if (!reason) {
    return (
      <div className="tool-input tool-plan-empty">プラン作成モードに入りました</div>
    )
  }
  return (
    <div className="tool-input">
      <div className="tool-subtitle">{truncate(reason, 240)}</div>
    </div>
  )
}

// ─── Monitor / ScheduleWakeup ───────────────────────────────────────────────

export function MonitorRenderer({ input }: { input: Input }) {
  // Monitor typically takes a command-like spec; fall back to scalar args.
  // Avoid stringifying nested objects to "[object Object]"; let the generic
  // renderer handle structured payloads instead.
  const command = asString(input.command ?? input.spec)
  const description = asString(input.description ?? input.until)
  if (!command && !description) {
    return <GenericInputRenderer input={input} />
  }
  return (
    <div className="tool-input">
      {description && <div className="tool-subtitle">{description}</div>}
      {command && <pre className="tool-code-block">{truncate(command, 300)}</pre>}
    </div>
  )
}

export function ScheduleWakeupRenderer({ input }: { input: Input }) {
  const at = asString(input.at ?? input.when ?? input.timestamp)
  const after = asString(input.after ?? input.delay)
  const reason = asString(input.reason ?? input.message ?? input.note)
  if (!at && !after && !reason) {
    return <GenericInputRenderer input={input} />
  }
  return (
    <div className="tool-input">
      {(at || after) && (
        <div className="tool-task-row">
          {at && <span className="tool-task-tag">at: {at}</span>}
          {after && <span className="tool-task-tag">after: {after}</span>}
        </div>
      )}
      {reason && <div className="tool-subtitle">{truncate(reason, 240)}</div>}
    </div>
  )
}

// ─── ToolSearch ─────────────────────────────────────────────────────────────

export function ToolSearchRenderer({ input }: { input: Input }) {
  const query = asString(input.query)
  const max = input.max_results
  return (
    <div className="tool-input">
      {query && <div className="tool-query">{truncate(query, 240)}</div>}
      {max != null && (
        <span className="tool-task-tag">max: {String(max)}</span>
      )}
    </div>
  )
}

// ─── Generic MCP formatter ──────────────────────────────────────────────────

export function McpRenderer({
  toolName,
  input,
}: {
  toolName: string
  input: Input
}) {
  const parsed = parseMcpToolName(toolName)
  const keyArgs = pickKeyInputArgs(input, 2)
  return (
    <div className="tool-input">
      {parsed && (
        <div className="tool-mcp-route">
          <span className="tool-mcp-server">{parsed.server}</span>
          {parsed.method && (
            <>
              <span className="tool-mcp-sep">·</span>
              <span className="tool-mcp-method">{parsed.method}</span>
            </>
          )}
        </div>
      )}
      {keyArgs.length > 0 && (
        <ul className="tool-kv-list">
          {keyArgs.map(arg => (
            <li key={arg.key} className="tool-kv">
              <span className="tool-kv-key">{arg.key}</span>
              <span className="tool-kv-value">{arg.display}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Generic / unknown tool fallback ────────────────────────────────────────

export function GenericInputRenderer({ input }: { input: Input }) {
  const keyArgs = pickKeyInputArgs(input, 2)
  if (keyArgs.length === 0) {
    // Final fallback: at least show how many keys are present.
    const total = Object.keys(input ?? {}).length
    if (total === 0) return null
    return (
      <div className="tool-input">
        <div className="tool-subtitle tool-subtitle--muted">
          {summarizeValue(input)}
        </div>
      </div>
    )
  }
  return (
    <div className="tool-input">
      <ul className="tool-kv-list">
        {keyArgs.map(arg => (
          <li key={arg.key} className="tool-kv">
            <span className="tool-kv-key">{arg.key}</span>
            <span className="tool-kv-value">{arg.display}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
