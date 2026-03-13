import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Chart, registerables } from 'chart.js'
import './index.css'
import App from './App.tsx'

Chart.register(...registerables)
Chart.defaults.color = '#8b949e'
Chart.defaults.borderColor = '#30363d'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
