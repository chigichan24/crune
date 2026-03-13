import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Chart, registerables } from 'chart.js'
import './index.css'
import App from './App.tsx'

Chart.register(...registerables)
Chart.defaults.color = '#8b7aaa'
Chart.defaults.borderColor = '#e4d9f5'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
