import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AppDataProvider } from './lib/AppData'
import { HistoryPage } from './pages/HistoryPage'
import { SimulationPage } from './pages/SimulationPage'
import { WebcamPage } from './pages/WebcamPage'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/simulation" replace />} />
            <Route path="/simulation" element={<SimulationPage />} />
            <Route path="/webcam" element={<WebcamPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/simulation" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppDataProvider>
  </StrictMode>,
)
