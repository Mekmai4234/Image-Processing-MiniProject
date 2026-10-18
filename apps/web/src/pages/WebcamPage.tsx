import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  History,
  RotateCw,
  Sparkles,
} from 'lucide-react'
import { CameraPanel } from '../features/webcam'
import { getHealth } from '../lib/api'
import type { InspectionResult } from '../types/inspection'

export const WebcamPage: React.FC = () => {
  const [backendHealth, setBackendHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  const [selectedProduct, setSelectedProduct] = useState<string>('bottle_a')
  const [recentInspections, setRecentInspections] = useState<InspectionResult[]>([])

  // Check backend health on mount
  useEffect(() => {
    let active = true

    const checkService = async () => {
      try {
        const health = await getHealth()
        if (active && health.status === 'ok') {
          setBackendHealth('online')
        }
      } catch {
        if (active) setBackendHealth('offline')
      }
    }

    checkService()
    return () => {
      active = false
    }
  }, [])

  const handleInspectionDone = (result: InspectionResult) => {
    setRecentInspections((prev) => [result, ...prev].slice(0, 5))
  }

  return (
    <div className="webcam-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="page-title">ระบบตรวจสอบฉลากผ่านเว็บแคม (Webcam Live)</h1>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                backendHealth === 'online'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : backendHealth === 'checking'
                  ? 'bg-slate-100 text-slate-600 border border-slate-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {backendHealth === 'online' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              {backendHealth === 'offline' && <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
              {backendHealth === 'checking' && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
              <span>
                Backend:{' '}
                {backendHealth === 'online'
                  ? 'เชื่อมต่อสำเร็จ'
                  : backendHealth === 'checking'
                  ? 'กำลังตรวจสอบ...'
                  : 'ออฟไลน์ (127.0.0.1:8000)'}
              </span>
            </span>
          </div>
        </div>
        <p className="page-description">
          เปิดกล้องโน้ตบุ๊ก ถือขวดน้ำดื่มให้อยู่ในกรอบ และหมุนขวดตามคำแนะนำแบบไดนามิก เมื่อฉลากเข้ามุมที่ชัดเจน
          ระบบจะแสดงสถานะพร้อมตรวจเพื่อบันทึกและส่งตรวจสอบตำแหน่งและความถูกต้องทันที
        </p>
      </div>

      {/* Main Camera Inspection Panel */}
      <CameraPanel
        expectedProduct={selectedProduct}
        onProductChange={(p) => setSelectedProduct(p)}
        onInspectionComplete={handleInspectionDone}
        autoLocate={true}
      />

      {/* Guidance & Tips Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginTop: '2rem' }}>
        {/* Instruction Tips */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '1rem', padding: '1.25rem' }}>
          <div className="flex items-center gap-2 mb-3 font-bold text-slate-800 text-sm">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>คำแนะนำสำหรับการตรวจจับที่แม่นยำ</span>
          </div>
          <ul style={{ fontSize: '0.8125rem', color: '#475569', lineHeight: 1.6, paddingLeft: '1.25rem' }}>
            <li>ถือขวดน้ำในระยะประมาณ 25–40 เซนติเมตร จากเลนส์กล้องเว็บแคม</li>
            <li>ขยับตัวขวดให้อยู่ภายในกรอบเส้นประสีฟ้ากึ่งกลางหน้าจอ</li>
            <li>หมุนขวดช้าๆ เพื่อให้หน้าฉลากหันเข้าหากล้องตรงๆ และรอข้อความแจ้งเตือนสีเขียว</li>
            <li>หลีกเลี่ยงแสงสะท้อนจ้าบนพื้นผิวพลาสติกใสหรือเงามืดบนตัวหนังสือฉลาก</li>
          </ul>
        </div>

        {/* Recent Session Inspects */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '1rem', padding: '1.25rem' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <History className="w-4 h-4 text-slate-600" />
              <span>ผลการตรวจล่าสุดในเซสชันนี้</span>
            </div>
            <span className="text-xs text-slate-400 font-semibold">{recentInspections.length} รายการ</span>
          </div>

          {recentInspections.length === 0 ? (
            <div className="text-xs text-slate-400 py-6 text-center">
              ยังไม่มีประวัติการตรวจในเซสชันนี้ กดปุ่ม "ถ่ายภาพเพื่อตรวจ" ด้านบนเพื่อเริ่มรายการแรก
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {recentInspections.map((item) => (
                <div
                  key={item.inspection_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.75rem',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        fontWeight: 800,
                        padding: '0.15rem 0.45rem',
                        borderRadius: '0.25rem',
                        background:
                          item.result === 'PASS'
                            ? '#ecfdf5'
                            : item.result === 'FAIL'
                            ? '#fef2f2'
                            : '#fffbeb',
                        color:
                          item.result === 'PASS'
                            ? '#059669'
                            : item.result === 'FAIL'
                            ? '#dc2626'
                            : '#d97706',
                      }}
                    >
                      {item.result}
                    </span>
                    <span className="font-semibold text-slate-700">{item.expected_product}</span>
                    <span className="text-slate-400">({item.reason})</span>
                  </div>
                  <span className="font-mono text-slate-500">
                    {item.timing_ms.total}ms • {item.storage_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
