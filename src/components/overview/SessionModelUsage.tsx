import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import type { ModelUsageItem } from '../../types'
import './SessionModelUsage.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface Props {
  usage: ModelUsageItem[]
}

const CHART_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']

export function SessionModelUsage({ usage }: Props) {
  const data = {
    labels: usage.map((u) => u.model),
    datasets: [
      {
        data: usage.map((u) => u.count),
        backgroundColor: usage.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderColor: '#ffffff',
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
          color: '#1c1917',
          font: { size: 11 },
          padding: 12,
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#1c1917',
        bodyColor: '#1c1917',
        borderColor: '#e7e5e4',
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
