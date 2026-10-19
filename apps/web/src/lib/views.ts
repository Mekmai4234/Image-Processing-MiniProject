import type { EvidenceRequest, InspectionRequest, ProductId } from '../types/inspection'

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

/**
 * สร้างคำขอตรวจจากชุดภาพ ตาม contract v0.2
 * - ภาพหลักไม่ทราบมุม = ไม่ส่ง angle_deg
 * - ภาพสนับสนุนเรียงตามลำดับในชุด; มุมที่ไม่ทราบเป็น null ณ index เดิม
 */
export function buildSimulationRequest(
  views: ViewItem[],
  primaryId: string | null,
  expected: ProductId,
  clientRequestId: string,
): InspectionRequest | null {
  const primary = views.find((v) => v.id === primaryId) ?? views[0]
  if (!primary) return null
  const supporting = views.filter((v) => v.id !== primary.id)
  const req: InspectionRequest = {
    image: primary.blob,
    imageName: primary.name,
    expected_product: expected,
    source_mode: 'simulation',
    client_request_id: clientRequestId,
  }
  if (primary.angle !== null) req.angle_deg = primary.angle
  if (supporting.length > 0) {
    req.supporting_images = supporting.map((v) => ({ blob: v.blob, name: v.name }))
    const evidence: EvidenceRequest = {
      kind: 'multi_view',
      // ยังไม่มีขั้น ORIENT ของงาน 02: ส่งชุดภาพตรง ๆ ไม่อ้างว่าค้นหามุมแล้ว
      search_status: 'not_requested',
      supporting_angles_deg: supporting.map((v) => v.angle),
      reported_coverage_deg: null,
    }
    req.evidence = evidence
  }
  return req
}
