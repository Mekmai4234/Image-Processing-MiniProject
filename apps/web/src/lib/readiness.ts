import type { HealthStatus } from '../types/inspection'

export type ReadyState = 'ready' | 'not_ready' | 'unknown'

export interface Readiness {
  /** ตัวตรวจจริงพร้อมรับงานหรือไม่ (แยกจาก service online) */
  detector: ReadyState
  detectorReason: string | null
  /** ที่เก็บไฟล์ของ backend เขียนได้หรือไม่ */
  storage: ReadyState
}

const toState = (v: boolean | undefined): ReadyState => (v === true ? 'ready' : v === false ? 'not_ready' : 'unknown')

/** แปลงผล GET /api/health เป็นสถานะที่หน้าเว็บแสดง; ฟิลด์ที่ไม่ได้ส่งมาถือว่า "ยังไม่ทราบ" ไม่เดาว่าพร้อม */
export function readinessOf(h: HealthStatus): Readiness {
  const detector = toState(h.detector_ready)
  return {
    detector,
    detectorReason: detector === 'not_ready' ? (h.detector_reason?.trim() || null) : null,
    storage: toState(h.storage_root_ready),
  }
}
