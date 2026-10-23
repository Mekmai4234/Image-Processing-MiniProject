// ตัวช่วยของหน้า Simulation (01): สถิติรอบนี้ + ขั้นใน pipeline + ข้อความ error ของฉาก
// ไม่มี React/Three.js เพื่อให้ทดสอบได้ตรง ๆ
import type { InspectionResult } from '../types/inspection'
import { ApiError, describeApiError, type ApiErrorKind } from './api'

export interface SessionStats {
  total: number
  pass: number
  fail: number
  review: number
  /** inspection_id ที่นับแล้ว กันนับซ้ำ */
  ids: readonly string[]
}

export const EMPTY_STATS: SessionStats = { total: 0, pass: 0, fail: 0, review: 0, ids: [] }

/**
 * นับผลหนึ่งรายการจาก onCompleted ของฉาก (ครั้งเดียวต่อ inspection_id)
 * ถ้า id เดิมมาอีกให้คงค่าเดิม — กันกรณี remount หรือ event ซ้ำ
 */
export function addCompleted(stats: SessionStats, result: InspectionResult): SessionStats {
  if (stats.ids.includes(result.inspection_id)) return stats
  return {
    total: stats.total + 1,
    pass: stats.pass + (result.result === 'PASS' ? 1 : 0),
    fail: stats.fail + (result.result === 'FAIL' ? 1 : 0),
    review: stats.review + (result.result === 'REVIEW' ? 1 : 0),
    ids: [...stats.ids, result.inspection_id],
  }
}

/** สัดส่วนเป็นข้อความ เช่น 93.8% — ยังไม่มีข้อมูลคืน null */
export function percentOf(part: number, total: number): string | null {
  if (total <= 0) return null
  return `${((part / total) * 100).toFixed(1)}%`
}

export const PIPELINE_STAGES = [
  { key: 'feed', label: 'Feed', detail: 'ขวดเข้าสายพาน' },
  { key: 'orient', label: 'Orient', detail: 'หมุนขวดอัตโนมัติ' },
  { key: 'inspect', label: 'Inspect', detail: 'ส่งภาพจริงให้ Backend ตรวจ' },
  { key: 'sort', label: 'Sort', detail: 'คัดแยกตามผลจริง' },
  { key: 'output', label: 'Output', detail: 'ขวดถึงปลายทาง' },
] as const

type Phase =
  | 'IDLE'
  | 'FEED'
  | 'ORIENT'
  | 'SETTLE'
  | 'INSPECT'
  | 'WAIT_RESULT'
  | 'SORT'
  | 'OUTPUT'
  | 'COMPLETE'
  | 'PAUSED'
  | 'ERROR'

const STAGE_OF_PHASE: Partial<Record<Phase, number>> = {
  FEED: 0,
  ORIENT: 1,
  SETTLE: 1,
  INSPECT: 2,
  WAIT_RESULT: 2,
  SORT: 3,
  OUTPUT: 4,
  COMPLETE: PIPELINE_STAGES.length, // ครบทุกขั้น
}

const STAGE_OF_STATION: Record<string, number> = {
  conveyor: 0,
  orient_turntable: 1,
  inspect_camera: 2,
  reject_tray: 4,
  review_lane: 4,
  pass_output: 4,
}

export interface StageInfo {
  /** ขั้นที่กำลังทำ; -1 = ยังไม่เริ่ม; เท่ากับจำนวนขั้น = ครบแล้ว */
  index: number
  /** ขั้นนี้ติด ERROR (ระบบขัดข้อง ไม่ใช่ผลสินค้า) */
  error: boolean
}

/**
 * แปลง snapshot ของฉากเป็นขั้นใน pipeline ของหน้า
 * ใช้ phase จริง (ตอน pause ยังรู้ว่าอยู่ขั้นไหน) และใช้ตำแหน่งขวดเมื่อเป็น ERROR
 */
export function pipelineStage(snap: { phase: string; current_station: string | null } | null): StageInfo {
  if (!snap) return { index: -1, error: false }
  if (snap.phase === 'ERROR') {
    const at = snap.current_station ? STAGE_OF_STATION[snap.current_station] : undefined
    return { index: at ?? 2, error: true }
  }
  return { index: STAGE_OF_PHASE[snap.phase as Phase] ?? -1, error: false }
}

const PORT_KINDS: readonly ApiErrorKind[] = ['http', 'network', 'aborted', 'config', 'invalid_response']

/**
 * ข้อความภาษาไทยสำหรับ error ของฉาก ใช้กติกาเดียวกับ describeApiError ของทั้งเว็บ
 * kind ที่ client กลางไม่รู้จัก (เช่น timeout ของฉาก) ใช้ข้อความจากฉากตรง ๆ
 */
export function simErrorText(err: { kind: string; status: number | null; code: string; message: string }): string {
  if (!PORT_KINDS.includes(err.kind as ApiErrorKind)) return err.message
  return describeApiError(new ApiError(err.kind as ApiErrorKind, err.message, { status: err.status ?? undefined, code: err.code }))
}
