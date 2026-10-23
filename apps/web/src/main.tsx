import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AppDataProvider } from './lib/AppData'
import { HistoryPage } from './pages/HistoryPage'
import { WebcamPage } from './pages/WebcamPage'
import { ReferencePage } from './pages/ReferencePage'
import './styles/global.css'

// หน้า Simulation มี Three.js ขนาดใหญ่ โหลดแยกเฉพาะตอนเปิดหน้านี้ หน้า Webcam/History จึงเปิดเร็วขึ้น
const SimulationPage = lazy(() => import('./pages/SimulationPage').then((m) => ({ default: m.SimulationPage })))
const pageLoading = <p className="hint" role="status">กำลังโหลดหน้า…</p>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/simulation" replace />} />
            <Route
              path="/simulation"
              element={
                <Suspense fallback={pageLoading}>
                  <SimulationPage />
                </Suspense>
              }
            />
            <Route path="/webcam" element={<WebcamPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<ReferencePage />} />
            <Route path="*" element={<Navigate to="/simulation" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppDataProvider>
  </StrictMode>,
)
