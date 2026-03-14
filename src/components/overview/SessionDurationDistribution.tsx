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
    labels: distribution.map((d) => d.bucket),
    datasets: [
      {
        data: distribution.map((d) => d.count),
        backgroundColor: '#6366f1',
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
        ticks: { color: '#78716c', font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        ticks: { color: '#78716c' },
        grid: { color: '#e7e5e4' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#1c1917',
        bodyColor: '#1c1917',
        borderColor: '#e7e5e4',
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
