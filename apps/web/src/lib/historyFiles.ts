import type { InspectionResult } from '../types/inspection'
import { shortId } from './format'

/** saved = มีในเครื่อง backend, pending = กำลังเขียน, missing = ยังไม่บันทึก, unknown = API ยังไม่บอก */
export type FileState = 'saved' | 'pending' | 'missing' | 'unknown'

export interface LocalFileRow {
  /** path ภายในโฟลเดอร์ของรอบตรวจ ตาม docs/storage-guide.md */
  name: string
  kind: 'Image' | 'JSON'
  state: FileState
}

/**
 * รายการไฟล์ในเครื่องที่รันได้จากข้อมูล API เท่านั้น ไม่เดาเกินที่ backend บอก
 * - storage_status=saved แปลว่าไฟล์หลักฐานที่จำเป็นครบ (รวม result.json) ตาม storage guide
 * - ยังไม่ saved: ภาพดูจาก URL ที่มี/null ตาม index เดิม ส่วน result.json ไม่ทราบสถานะ
 */
export function localFiles(r: InspectionResult): LocalFileRow[] {
  const allSaved = r.storage_status === 'saved'
  const notYet: FileState = r.storage_status === 'pending' ? 'pending' : 'missing'
  const image = (url: string | null | undefined): FileState => (allSaved || url ? 'saved' : notYet)

  return [
    { name: 'original.jpg', kind: 'Image', state: image(r.images.original) },
    { name: 'annotated.jpg', kind: 'Image', state: image(r.images.annotated) },
    { name: 'result.json', kind: 'JSON', state: allSaved ? 'saved' : 'unknown' },
    ...r.evidence.supporting_images.map(
      (url, i): LocalFileRow => ({ name: `supporting/${i}.jpg`, kind: 'Image', state: image(url) }),
    ),
  ]
}

/** ชื่อไฟล์สำหรับปุ่ม Download result (ผลล่าสุดจาก API ไม่ใช่การอ่าน result.json) */
export function resultFileName(r: InspectionResult): string {
  return `inspection-${shortId(r.inspection_id)}.json`
}
