import { Box, Camera, HardDrive, History, RefreshCw, ScanSearch, WifiOff } from 'lucide-react'
import { Brand, Logo } from './Logo'
import { NavLink, Outlet } from 'react-router-dom'
import { DEMO_SCENARIOS, type DemoScenario } from '../demo/demoDataSource'
import { useAppData } from '../lib/AppData'
import { API_BASE_URL } from '../lib/config'

function ConnectionPill() {
  const { connection } = useAppData()
  switch (connection.state) {
    case 'checking':
      return <span className="pill checking"><span className="dot" />กำลังเชื่อม API</span>
    case 'online': {
      const { detector } = connection.readiness
      const version = connection.configVersion ? ` · ${connection.configVersion}` : ''
      if (detector === 'not_ready') {
        return (
          <span className="pill warn" title={`${API_BASE_URL}${version}`}>
            <span className="dot" />API พร้อม · ตัวตรวจยังไม่พร้อม
          </span>
        )
      }
      if (detector === 'ready') {
        return (
          <span className="pill online" title={`${API_BASE_URL}${version}`}>
            <span className="dot" />API พร้อม · ตัวตรวจพร้อม
          </span>
        )
      }
      return (
        <span className="pill online" title={`${API_BASE_URL}${version} · Backend ยังไม่รายงานความพร้อมของตัวตรวจ`}>
          <span className="dot" />API พร้อม
        </span>
      )
    }
    case 'offline':
      return <span className="pill offline" title={connection.message}><span className="dot" />API ไม่ตอบ</span>
    case 'demo':
      return null
  }
}

export function AppShell() {
  const { source, setSource, connection, recheck, scenario, setScenario } = useAppData()

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        ข้ามไปเนื้อหาหลัก
      </a>
      <header className="topbar">
        <div className="brand-block">
          <NavLink to="/simulation" className="brand" aria-label="Vending Vision หน้า Simulation">
            <Logo />
            <Brand />
          </NavLink>
          <span className="brand-sub">Thai Student Bottle Label Inspection Project</span>
        </div>

        <nav className="nav" aria-label="โหมดการทำงาน">
          <NavLink to="/simulation">
            <Box size={17} aria-hidden="true" /> Simulation
          </NavLink>
          <NavLink to="/webcam">
            <Camera size={17} aria-hidden="true" /> Webcam
          </NavLink>
          <NavLink to="/history">
            <History size={17} aria-hidden="true" /> History
          </NavLink>
        </nav>

        <div className="top-actions">
          <ConnectionPill />
          <div className="segmented" role="group" aria-label="แหล่งข้อมูล">
            <button aria-pressed={source === 'live'} onClick={() => setSource('live')}>
              API จริง
            </button>
            <button className="is-demo" aria-pressed={source === 'demo'} onClick={() => setSource('demo')}>
              DEMO
            </button>
          </div>
        </div>
      </header>

      {source === 'demo' && (
        <div className="demo-bar" role="status">
          <strong>โหมด DEMO</strong>
          <span>ข้อมูลสังเคราะห์จาก examples/ ไม่ได้ตรวจภาพจริง ใช้ทดสอบหน้าจอเท่านั้น</span>
          <label className="row">
            ผลที่จะจำลอง
            <select value={scenario} onChange={(e) => setScenario(e.target.value as DemoScenario)}>
              {Object.entries(DEMO_SCENARIOS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {source === 'live' && connection.state === 'offline' && (
        <div className="offline-bar" role="alert">
          <WifiOff size={16} aria-hidden="true" />
          <span>{connection.message}</span>
          <button className="btn btn-sm" onClick={recheck}>
            <RefreshCw size={14} aria-hidden="true" /> ลองเชื่อมใหม่
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSource('demo')}>
            ดูหน้าจอด้วยข้อมูล DEMO
          </button>
        </div>
      )}

      {source === 'live' && connection.state === 'online' && connection.readiness.detector === 'not_ready' && (
        <div className="readiness-bar" role="status">
          <ScanSearch size={16} aria-hidden="true" />
          <span>
            <strong>ตัวตรวจยังไม่พร้อม</strong> {connection.readiness.detectorReason ?? 'Backend ยังไม่มี config หรือภาพอ้างอิงของสินค้า'}
            {' '}การตรวจจริงจะได้ ERROR จนกว่าจะพร้อม ส่วนประวัติยังเปิดดูได้
          </span>
          <button className="btn btn-sm" onClick={recheck}>
            <RefreshCw size={14} aria-hidden="true" /> ตรวจสถานะใหม่
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSource('demo')}>
            ลองหน้าจอด้วยข้อมูล DEMO
          </button>
        </div>
      )}

      {source === 'live' && connection.state === 'online' && connection.readiness.storage === 'not_ready' && (
        <div className="readiness-bar" role="status">
          <HardDrive size={16} aria-hidden="true" />
          <span>
            <strong>ที่เก็บไฟล์ของ Backend เขียนไม่ได้</strong> ผลตรวจยังแสดงได้ แต่จะขึ้นสถานะบันทึกไม่สำเร็จ ตรวจ STORAGE_ROOT บนเครื่องที่รัน Backend
          </span>
        </div>
      )}

      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="footer">
        <span>Vending Vision ระบบตรวจฉลากขวดน้ำด้วย Image Processing</span>
        <span>{source === 'demo' ? 'กำลังแสดงข้อมูลสังเคราะห์ (DEMO)' : `API: ${API_BASE_URL || 'ยังไม่ได้ตั้ง VITE_API_BASE_URL'}`}</span>
      </footer>
    </div>
  )
}
