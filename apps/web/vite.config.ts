/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// .env อยู่ที่ repository root (ดู docs/configuration.md)
// คำนวณจากตำแหน่งไฟล์นี้ ไม่ขึ้นกับ directory ที่เปิด terminal
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  // browser อ่านได้เฉพาะตัวแปร VITE_* (ใช้จริงแค่ VITE_API_BASE_URL)
  envPrefix: 'VITE_',
  server: {
    // ต้องตรงกับ WEB_ORIGIN ของ backend: http://localhost:5173
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // อนุญาตให้ import ข้อมูลสังเคราะห์จาก examples/ ที่ root
    fs: { allow: [repoRoot] },
  },
  preview: { host: 'localhost', port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
