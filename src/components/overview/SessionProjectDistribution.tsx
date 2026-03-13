import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import type { ProjectDistItem } from '../../types'
import './SessionProjectDistribution.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface Props {
  distribution: ProjectDistItem[]
}

const CHART_COLORS = ['#a78bfa', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#fbbf24']

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
          color: '#8b7aaa',
          font: { size: 11 },
          padding: 12,
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#3b2960',
        bodyColor: '#3b2960',
        borderColor: '#e4d9f5',
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
