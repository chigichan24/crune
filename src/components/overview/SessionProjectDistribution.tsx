import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import type { ProjectDistItem } from '../../types'
import './SessionProjectDistribution.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface Props {
  distribution: ProjectDistItem[]
}

const CHART_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#bc8cff', '#f85149']

export function SessionProjectDistribution({ distribution }: Props) {
  const data = {
    labels: distribution.map((d) => d.project),
    datasets: [
      {
        data: distribution.map((d) => d.sessionCount),
        backgroundColor: distribution.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
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
    <div className="project-distribution-chart">
      <Doughnut data={data} options={options} />
    </div>
  )
}
