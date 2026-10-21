import { fileURLToPath } from 'node:url'
import { defineConfig } from '../../apps/web/node_modules/vite/dist/node/index.js'
import react from '../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js'

const repo = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  cacheDir: fileURLToPath(new URL('../.venv/harness-vite-cache', import.meta.url)),
  resolve: { alias: {
    react: fileURLToPath(new URL('../../apps/web/node_modules/react', import.meta.url)),
    'react-dom': fileURLToPath(new URL('../../apps/web/node_modules/react-dom', import.meta.url)),
  } },
  server: { host:'127.0.0.1', port:5187, strictPort:true, fs:{allow:[repo]} },
})
