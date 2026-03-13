import { useState } from 'react'
import './SessionActivityHeatmap.css'

interface Props {
  heatmap: number[][] // [7][24] dayOfWeek x hour
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function SessionActivityHeatmap({ heatmap }: Props) {
  const [tooltip, setTooltip] = useState<{ day: string; hour: number; count: number; x: number; y: number } | null>(null)

  // Find max value for opacity scaling
  const maxValue = Math.max(1, ...heatmap.flat())

  const handleMouseEnter = (dayIndex: number, hour: number, count: number, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTooltip({
      day: DAY_LABELS[dayIndex],
      hour,
      count,
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
  }

  const handleMouseLeave = () => {
    setTooltip(null)
  }

  return (
    <div className="heatmap-container">
      <div className="heatmap-grid">
        {/* Top-left corner spacer */}
        <div className="heatmap-spacer" />

        {/* Hour labels */}
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h-${h}`} className="heatmap-hour-label">
            {h % 3 === 0 ? h : ''}
          </div>
        ))}

        {/* Rows: day label + 24 cells */}
        {heatmap.map((row, dayIndex) => (
          <div key={`row-${dayIndex}`} className="heatmap-row">
            <div className="heatmap-day-label">{DAY_LABELS[dayIndex]}</div>
            {row.map((count, hour) => (
              <div
                key={`${dayIndex}-${hour}`}
                className="heatmap-cell"
                style={{
                  backgroundColor: count === 0
                    ? 'var(--bg-tertiary)'
                    : `color-mix(in srgb, var(--chart-1) ${Math.round((count / maxValue) * 100)}%, var(--bg-tertiary))`,
                }}
                onMouseEnter={(e) => handleMouseEnter(dayIndex, hour, count, e)}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="heatmap-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
          }}
        >
          {tooltip.day} {tooltip.hour}:00 - {tooltip.count} session{tooltip.count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
