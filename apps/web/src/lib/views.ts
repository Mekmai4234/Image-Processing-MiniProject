/** ภาพหนึ่งมุมในชุดตรวจ; angle=null คือยังไม่ทราบมุม (ห้ามเดาแทนผู้ใช้) */
export interface ViewItem {
  id: string
  blob: Blob
  name: string
  angle: number | null
}

/**
 * ต่อภาพใหม่ท้ายชุดเดิม
 * - ภาพเดิมคงมุมของตัวเองทุกค่า รวมถึง null
 * - ภาพใหม่ใช้มุมที่ส่งมาเท่านั้น (ไฟล์ที่ผู้ใช้อัปโหลดมาเป็น null)
 * - เกิน max ตัดภาพใหม่ส่วนเกินออก ไม่ตัดภาพเดิม
 */
export function appendViews<T extends ViewItem>(existing: T[], incoming: T[], max: number): { views: T[]; dropped: number } {
  const room = Math.max(0, max - existing.length)
  const accepted = incoming.slice(0, room)
  return { views: [...existing, ...accepted], dropped: incoming.length - accepted.length }
}

/** เปลี่ยนมุมของภาพเดียว ภาพอื่นไม่เปลี่ยน */
export function setViewAngle<T extends ViewItem>(views: T[], id: string, angle: number | null): T[] {
  return views.map((v) => (v.id === id ? { ...v, angle } : v))
}

/** ลบภาพเดียว ภาพที่เหลือคงมุมเดิมและลำดับเดิม */
export function removeView<T extends ViewItem>(views: T[], id: string): T[] {
  return views.filter((v) => v.id !== id)
}
