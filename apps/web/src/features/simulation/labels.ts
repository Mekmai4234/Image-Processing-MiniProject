import type { InspectionReason, InspectionVerdict } from './api/contract'
import type { DisplayState, Route } from './machine/types'

/** Thai UI copy for the simulation. 01 may move these into shared i18n later. */
export const STATE_LABEL: Record<DisplayState, string> = {
  IDLE: 'พร้อมเริ่ม',
  FEED: 'ปล่อยขวดเข้าสายพาน',
  ORIENT: 'หมุนหาฉลาก',
  SETTLE: 'หยุดนิ่งก่อนถ่าย',
  INSPECT: 'ถ่ายภาพตรวจ',
  WAIT_RESULT: 'รอผลจาก Backend',
  SORT: 'คัดแยกตามผลตรวจ',
  OUTPUT: 'ส่งไปปลายทาง',
  COMPLETE: 'เสร็จสิ้น',
  PAUSED: 'หยุดชั่วคราว',
  ERROR: 'ระบบขัดข้อง',
}

export const VERDICT_LABEL: Record<InspectionVerdict, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REVIEW: 'ตรวจไม่ได้ — ถ่ายใหม่',
}

export const REASON_LABEL: Record<InspectionReason, string> = {
  good: 'ฉลากถูกต้อง',
  wrong_label: 'ฉลากผิดสินค้า',
  misplaced_label: 'ฉลากผิดตำแหน่ง',
  missing_label: 'ไม่มีฉลาก (หลักฐานยืนยันแล้ว)',
  blurred_image: 'ภาพเบลอ',
  label_not_visible: 'มองไม่เห็นฉลาก',
  unknown_product: 'ไม่รู้จักสินค้า',
  ambiguous_match: 'ผลเทียบใกล้เคียงกันเกินไป',
  orientation_failed: 'หาด้านที่เห็นฉลากไม่พบ',
}

export const ROUTE_LABEL: Record<Route, string> = {
  pass: 'ช่องรับสินค้า (PASS)',
  reject: 'ถาดคัดออก (REJECT)',
  review: 'ช่องรอถ่ายใหม่ (REVIEW)',
}

export const SEARCH_STATUS_LABEL = {
  not_requested: 'ไม่ได้ค้นหา (ภาพเดียว)',
  usable_view_found: 'พบมุมที่เห็นฉลาก',
  exhausted: 'ค้นครบทุกภาพแล้วไม่พบ',
  timed_out: 'หมดเวลาค้นหา',
} as const

export const SINGLE_VIEW_NOTICE =
  'ภาพเดียวเห็นเฉพาะด้านที่ถ่าย ระบบจึงไม่หมุนค้นหารอบขวด และไม่ได้ตรวจครบ 360° — เพิ่มภาพหลายมุมเพื่อค้นหาฉลาก'

export const MODEL_NOTICE = 'โมเดลขวดในฉากเป็นภาพแทน ไม่ใช่ภาพถ่ายรอบขวด ภาพที่ส่งตรวจคือภาพจริงในจอกล้องเท่านั้น'

export const RESET_NOTICE = 'งานที่ยกเลิกอาจถูก Backend ตรวจและบันทึกไปแล้ว — ดูได้ในหน้าประวัติ ระบบไม่ลบประวัติ'
