import type { InspectionFilesResponse, InspectionResult } from '../types/inspection'
import { shortId } from './format'

/** saved = มีในเครื่อง backend, pending = กำลังเขียน, missing = ยังไม่บันทึก, unknown = API ยังไม่บอก */
export type FileState = 'saved' | 'pending' | 'missing' | 'unknown'

export interface LocalFileRow {
  /** path ภายในโฟลเดอร์ของรอบตรวจ ตาม docs/storage-guide.md */
  name: string
  kind: 'Image' | 'JSON'
  state: FileState
}

/** Only current per-file metadata proves availability; a URL or historical saved row does not. */
export function localFiles(r: InspectionResult, metadata?: InspectionFilesResponse | null): LocalFileRow[] {
  if (metadata?.inspection_id === r.inspection_id) return metadata.files.map(f => ({
    name: f.name, kind: f.kind === 'result_json' ? 'JSON' : 'Image',
    state: f.available && f.size_bytes !== 0 ? 'saved' : 'missing',
  }))
  const state: FileState = r.storage_status === 'pending' ? 'pending' : 'unknown'
  return ['original.jpg','annotated.jpg','result.json',...r.evidence.supporting_images.map((_,i)=>`supporting/${i}.jpg`)]
    .map(name=>({name, kind:name.endsWith('.json')?'JSON':'Image',state}))
}

/** ชื่อไฟล์สำหรับปุ่ม Download result (ผลล่าสุดจาก API ไม่ใช่การอ่าน result.json) */
export function resultFileName(r: InspectionResult): string {
  return `inspection-${shortId(r.inspection_id)}.json`
}
