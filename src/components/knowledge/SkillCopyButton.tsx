import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy a synthesized skill to the clipboard, falling back to a file download
 * when the Clipboard API is unavailable (non-secure context / denied). Shared by
 * the knowledge views so the copy behaviour is consistent.
 */
export function SkillCopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable — download the skill so the action never silently
      // no-ops.
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'SKILL.md'
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [text])

  return (
    <button className={className} onClick={onCopy}>
      {copied ? 'コピーしました' : 'Skillをコピー'}
    </button>
  )
}
