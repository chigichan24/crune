import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import type { WeeklyToolTrend } from '../../types'
import './SessionToolTrends.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

interface Props {
  trends: WeeklyToolTrend[]
}

const CHART_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']

type ToolCategory = 'Core' | 'Agent' | 'Plan' | 'MCP' | 'Other'

const CORE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob'])
const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode'])

function categorize(toolName: string): ToolCategory {
  if (CORE_TOOLS.has(toolName)) return 'Core'
  if (toolName === 'Agent') return 'Agent'
  if (PLAN_TOOLS.has(toolName)) return 'Plan'
  if (toolName.startsWith('mcp__')) return 'MCP'
  return 'Other'
}

const CATEGORY_ORDER: ToolCategory[] = ['Core', 'Agent', 'Plan', 'MCP', 'Other']
const CATEGORY_COLORS: Record<ToolCategory, string> = {
  Core: CHART_COLORS[0],
  Agent: CHART_COLORS[1],
  Plan: CHART_COLORS[2],
  MCP: CHART_COLORS[3],
  Other: CHART_COLORS[4],
}

export function SessionToolTrends({ trends }: Props) {
  // Aggregate tools into categories per week
  const weekLabels = trends.map((t) => t.week)

  const categoryData: Record<ToolCategory, number[]> = {
    Core: [],
    Agent: [],
    Plan: [],
    MCP: [],
    Other: [],
  }

  for (const trend of trends) {
    const weekTotals: Record<ToolCategory, number> = {
      Core: 0,
      Agent: 0,
      Plan: 0,
      MCP: 0,
      Other: 0,
    }
    for (const [tool, count] of Object.entries(trend.tools)) {
      weekTotals[categorize(tool)] += count
    }
    for (const cat of CATEGORY_ORDER) {
      categoryData[cat].push(weekTotals[cat])
    }
  }

  // Compute totals per week for percentage stacking
  const weekTotals = weekLabels.map((_, i) =>
    CATEGORY_ORDER.reduce((sum, cat) => sum + categoryData[cat][i], 0)
  )

  // Convert to percentages
  const percentData: Record<ToolCategory, number[]> = {
    Core: [],
    Agent: [],
    Plan: [],
    MCP: [],
    Other: [],
  }
  for (const cat of CATEGORY_ORDER) {
    percentData[cat] = categoryData[cat].map((val, i) =>
      weekTotals[i] > 0 ? Math.round((val / weekTotals[i]) * 100) : 0
    )
  }

  const data = {
    labels: weekLabels,
    datasets: CATEGORY_ORDER.map((cat) => ({
      label: cat,
      data: percentData[cat],
      backgroundColor: CATEGORY_COLORS[cat],
      borderWidth: 0,
    })),
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#78716c', font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        stacked: true,
        max: 100,
        ticks: {
          color: '#78716c',
          callback: (value: number | string) => `${value}%`,
        },
        grid: { color: '#e7e5e4' },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: '#1c1917',
          font: { size: 11 },
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#1c1917',
        bodyColor: '#1c1917',
        borderColor: '#e7e5e4',
        borderWidth: 1,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => {
            const label = ctx.dataset.label || ''
            const val = ctx.parsed.y ?? 0
            return `${label}: ${val}%`
          },
        },
      },
    },
  }

  return (
    <div className="tool-trends-chart">
      <Bar data={data} options={options} />
    </div>
  )
}
