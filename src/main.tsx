import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Chart, registerables } from 'chart.js'
import './index.css'
import App from './App.tsx'

Chart.register(...registerables)
Chart.defaults.color = '#78716c'
Chart.defaults.borderColor = '#e7e5e4'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
