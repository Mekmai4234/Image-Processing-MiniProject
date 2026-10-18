import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Resolve repository root explicitly for envDir
const envDir = fileURLToPath(new URL('../../', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir,
  envPrefix: 'VITE_',
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
})
