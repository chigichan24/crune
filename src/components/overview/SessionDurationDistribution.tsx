import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import type { DurationBucket } from '../../types'
import './SessionDurationDistribution.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  distribution: DurationBucket[]
}

export function SessionDurationDistribution({ distribution }: Props) {
  const data = {
    labels: distribution.map((d) => d.rangeLabel),
    datasets: [
      {
        data: distribution.map((d) => d.count),
        backgroundColor: '#58a6ff',
        borderRadius: 4,
        borderWidth: 0,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: '#8b949e', font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        ticks: { color: '#8b949e' },
        grid: { color: '#30363d' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#21262d',
        titleColor: '#e6edf3',
        bodyColor: '#e6edf3',
        borderColor: '#30363d',
        borderWidth: 1,
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => {
            const val = ctx.parsed.y ?? 0
            return `${val} session${val !== 1 ? 's' : ''}`
          },
        },
      },
    },
  }

  return (
    <div className="duration-distribution-chart">
      <Bar data={data} options={options} />
    </div>
  )
}
