import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import type { ModelUsageItem } from '../../types'
import './SessionModelUsage.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface Props {
  usage: ModelUsageItem[]
}

const CHART_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#bc8cff', '#f85149']

export function SessionModelUsage({ usage }: Props) {
  const data = {
    labels: usage.map((u) => u.model),
    datasets: [
      {
        data: usage.map((u) => u.count),
        backgroundColor: usage.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderColor: 'var(--bg-secondary)',
        borderWidth: 2,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: '#8b949e',
          font: { size: 11 },
          padding: 12,
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: '#21262d',
        titleColor: '#e6edf3',
        bodyColor: '#e6edf3',
        borderColor: '#30363d',
        borderWidth: 1,
      },
    },
    cutout: '60%',
  }

  return (
    <div className="model-usage-chart">
      <Doughnut data={data} options={options} />
    </div>
  )
}
