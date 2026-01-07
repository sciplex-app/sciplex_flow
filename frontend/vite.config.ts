import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react-plotly.js', 'plotly.js-dist-min'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.VITE_API_URL || 'http://localhost:8000').replace('http', 'ws'),
        ws: true,
      },
    },
  },
  // Expose environment variables to the frontend
  define: {
    // Vite automatically exposes VITE_* env vars, but we can set defaults here
  },
})

