import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import type { ProjectDistItem } from '../../types'
import './SessionProjectDistribution.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface Props {
  distribution: ProjectDistItem[]
}

const CHART_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']

export function SessionProjectDistribution({ distribution }: Props) {
  const data = {
    labels: distribution.map((d) => (d as any).name ?? d.project),
    datasets: [
      {
        data: distribution.map((d) => d.sessionCount),
        backgroundColor: distribution.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
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
    <div className="project-distribution-chart">
      <Doughnut data={data} options={options} />
    </div>
  )
}
