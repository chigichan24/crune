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
      'Claude Codeのセッションログを解析し、スキル合成を含む可視化用データを生成します。上位5件のスキル候補がclaude -pで事前合成されます。',
    command: 'npm run analyze-sessions',
  },
  {
    number: 3,
    title: 'Start dev server',
    description: 'ローカル開発サーバーを起動してダッシュボードを表示します。再合成機能も使う場合はdev:fullを使ってください。',
    command: 'npm run dev:full',
  },
]

const DISTILL_OPTIONS = [
  {
    flag: '--synthesis-model <model>',
    description: '合成に使うモデルを指定（例: haiku で高速化）',
    example: 'npm run analyze-sessions -- --synthesis-model haiku',
  },
  {
    flag: '--synthesis-count <n>',
    description: '合成するスキル候補の数（デフォルト: 5）',
    example: 'npm run analyze-sessions -- --synthesis-count 3',
  },
  {
    flag: '--skip-synthesis',
    description: 'LLM合成をスキップして高速ビルド',
    example: 'npm run analyze-sessions -- --skip-synthesis',
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

        <h3 className="help-section-title">Synthesis Options</h3>
        <p className="help-intro">
          analyze-sessionsはスキル候補をclaude -pで合成します。以下のフラグでカスタマイズできます。
        </p>
        <div className="help-steps">
          {DISTILL_OPTIONS.map((opt) => (
            <div key={opt.flag} className="help-step">
              <div className="help-step-body">
                <h4 className="help-step-title"><code>{opt.flag}</code></h4>
                <p className="help-step-desc">{opt.description}</p>
                <div className="help-code-block">
                  <code className="help-code">{opt.example}</code>
                  <CopyButton text={opt.example} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="help-note">
          <span className="help-note-label">Note</span>
          セッションログは <code>~/.claude/projects/</code> から読み込まれます。
          パイプラインは <code>public/data/sessions/</code> 配下に静的JSONファイルを生成します。
          合成済みスキルはRuneビューで即座に確認・コピーできます。
        </div>
      </div>
    </div>
  )
}
