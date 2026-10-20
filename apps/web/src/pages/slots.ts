// ร่างข้อตกลง props/events สำหรับคอมโพเนนต์ที่ 02/04 จะส่งมาฝัง
// ยังเป็นร่างเพื่อคุยกัน — แก้ได้เมื่อ 02/04 ยืนยัน แล้วย้าย type ไป features/* ของเจ้าของงาน

import type { InspectionResult, ProductId } from '../types/inspection'

/** state ของฉากตาม docs/architecture.md */
export type SimulationState =
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

/** 02: features/simulation ส่ง <SimulationScene {...props} /> ให้ SimulationPage */
export interface SimulationSceneProps {
  expectedProduct: ProductId
  /** ภาพที่ผู้ใช้อัปโหลด เรียงตามมุม; angle null = ไม่ทราบมุม */
  views: Array<{ url: string; angle: number | null }>
  running: boolean
  speed: number
  /** ผลจาก Backend ใช้ตัดสินทางคัดแยก ห้ามสุ่มตาม timer */
  result: InspectionResult | null
  onStateChange(state: SimulationState): void
  /** ฉากขอให้หน้าเว็บส่งคำขอตรวจ เมื่อ ORIENT เจอมุมหรือหมดมุม */
  onInspectRequest(primaryIndex: number, searchStatus: 'usable_view_found' | 'exhausted' | 'timed_out'): void
}

/** 04: features/webcam ส่ง <CameraPanel {...props} /> ให้ WebcamPage และรับผิดชอบปิด media tracks */
export interface CameraPanelProps {
  /** false = ต้องหยุดกล้องทันที */
  active: boolean
  /** preview กลับซ้ายขวาหรือไม่ เพื่อให้ overlay mirror ตาม */
  mirrored: boolean
  onStatusChange(status: 'idle' | 'requesting' | 'streaming' | 'denied' | 'error', message?: string): void
  /** frame สำหรับ locator (throttle และมีคำขอค้างได้ครั้งเดียว) */
  onFrame?(frame: Blob): void
}

export interface CameraPanelHandle {
  /** ถ่ายภาพเต็มความละเอียด ไม่ mirror */
  capture(): Promise<Blob>
  stop(): void
}
