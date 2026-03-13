import { useState, useCallback, useEffect } from 'react'
import './HelpModal.css'

interface Props {
  onClose: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      className={`help-copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

const STEPS = [
  {
    number: 1,
    title: 'Clone & install',
    description: 'Install dependencies for crune.',
    command: 'npm install',
  },
  {
    number: 2,
    title: 'Run data pipeline',
    description:
      'Analyze your Claude Code session logs and generate visualization data.',
    command: 'npm run analyze-sessions',
  },
  {
    number: 3,
    title: 'Start dev server',
    description: 'Launch the local development server to view the dashboard.',
    command: 'npm run dev',
  },
]

export function HelpModal({ onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2 className="help-title">Data Update Guide</h2>
          <button className="help-close" onClick={onClose}>
            x
          </button>
        </div>

        <p className="help-intro">
          crune visualizes your local Claude Code session logs. Run the pipeline
          to refresh the data whenever you want to see your latest sessions.
        </p>

        <div className="help-steps">
          {STEPS.map((step) => (
            <div key={step.number} className="help-step">
              <div className="help-step-number">{step.number}</div>
              <div className="help-step-body">
                <h4 className="help-step-title">{step.title}</h4>
                <p className="help-step-desc">{step.description}</p>
                <div className="help-code-block">
                  <code className="help-code">{step.command}</code>
                  <CopyButton text={step.command} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="help-note">
          <span className="help-note-label">Note</span>
          Session logs are read from <code>~/.claude/projects/</code>. The
          pipeline generates static JSON files under{' '}
          <code>public/data/sessions/</code>.
        </div>
      </div>
    </div>
  )
}
