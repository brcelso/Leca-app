import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Leca-app/',
  build: {
    target: 'es2015', // Maximum compatibility for older Safari
  }
})
