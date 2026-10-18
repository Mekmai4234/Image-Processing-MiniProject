import React from 'react'
import { Camera, Eye, History, ShieldCheck } from 'lucide-react'
import { WebcamPage } from './pages/WebcamPage'
import './index.css'

export const App: React.FC = () => {
  return (
    <div className="app-layout">
      {/* Top Navigation Bar */}
      <header className="app-navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            <span>Vending Vision</span>
            <span className="navbar-badge">Contract v0.2</span>
          </div>

          <nav className="navbar-nav">
            <a href="#simulation" className="nav-link" title="หน้าจำลองสายพาน (02)">
              <Eye className="w-4 h-4" />
              <span>Simulation 3D</span>
            </a>
            <a href="#webcam" className="nav-link active" title="ตรวจฉลากผ่านเว็บแคม (04)">
              <Camera className="w-4 h-4" />
              <span>Webcam Live</span>
            </a>
            <a href="#history" className="nav-link" title="ประวัติการตรวจ (01)">
              <History className="w-4 h-4" />
              <span>History Log</span>
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-content">
        <WebcamPage />
      </main>
    </div>
  )
}

export default App
