import type { LocateResult } from '../../types/inspection'
import type { GuidanceInfo } from './types'

export function webcamGuidance(result: LocateResult | null): GuidanceInfo {
  if (result?.usable_view && result.quality.label_visible && result.quality.sharp_enough) {
    return { text: 'พบฉลากชัดเจนแล้ว พร้อมถ่าย!', subtext: 'ถือนิ่งสักครู่ ไม่จำเป็นต้องเห็นขวดเต็มใบ', tone: 'success', readyToCapture: true }
  }
  if (result?.reason === 'blurred_image' || (result?.quality.label_visible && !result.quality.sharp_enough)) {
    return { text: 'ฉลากยังไม่คมชัด', subtext: 'ถอยขวดออกเล็กน้อยและถือนิ่ง ให้กล้องโฟกัสฉลากก่อน', tone: 'warning', readyToCapture: false }
  }
  return { text: 'กำลังค้นหาฉลากที่ตรงภาพอ้างอิง…', subtext: 'หันฉลากเข้ากล้อง ให้เห็นฉลากครบ ไม่ต้องเห็นขวดทั้งใบ และไม่ต้องชิดเลนส์', tone: 'info', readyToCapture: false }
}
