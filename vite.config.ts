import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/synthesize': 'http://localhost:3456',
      '/api/feedback': 'http://localhost:3456',
      '/api/retrieve': 'http://localhost:3456',
    },
  },
})
