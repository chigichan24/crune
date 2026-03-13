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
    description: 'cruneの依存パッケージをインストールします。',
    command: 'npm install',
  },
  {
    number: 2,
    title: 'Run data pipeline',
    description:
      'Claude Codeのセッションログを解析し、可視化用データを生成します。',
    command: 'npm run analyze-sessions',
  },
  {
    number: 3,
    title: 'Start dev server',
    description: 'ローカル開発サーバーを起動してダッシュボードを表示します。',
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
          cruneはローカルのClaude Codeセッションログを可視化するツールです。
          最新のセッションを確認したいときにパイプラインを再実行してください。
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
          セッションログは <code>~/.claude/projects/</code> から読み込まれます。
          パイプラインは <code>public/data/sessions/</code> 配下に静的JSONファイルを生成します。
        </div>
      </div>
    </div>
  )
}
