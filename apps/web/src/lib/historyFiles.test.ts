import { describe, expect, it } from 'vitest'
import { DEMO_EXAMPLES } from '../demo/demoDataSource'
import type { InspectionResult } from '../types/inspection'
import { localFiles, resultFileName } from './historyFiles'

const clone = (r: InspectionResult): InspectionResult => JSON.parse(JSON.stringify(r)) as InspectionResult
const pass = DEMO_EXAMPLES[0]
const multi = DEMO_EXAMPLES[3] // orientation_failed มีภาพหลักฐาน 3 มุม

describe('localFiles: แสดงเฉพาะที่ backend บอก', () => {
  it('saved = ไฟล์หลักฐานครบรวม result.json', () => {
    expect(localFiles(pass)).toEqual([
      { name: 'original.jpg', kind: 'Image', state: 'saved' },
      { name: 'annotated.jpg', kind: 'Image', state: 'saved' },
      { name: 'result.json', kind: 'JSON', state: 'saved' },
    ])
  })

  it('ภาพหลักฐานหลายมุมเรียงตาม index เดิม', () => {
    expect(localFiles(multi).map((f) => f.name)).toEqual([
      'original.jpg',
      'annotated.jpg',
      'result.json',
      'supporting/0.jpg',
      'supporting/1.jpg',
      'supporting/2.jpg',
    ])
  })

  it('บันทึกไม่สำเร็จบางส่วน: ภาพที่ URL เป็น null = ยังไม่บันทึก และไม่อ้างว่า result.json อยู่', () => {
    const r = clone(multi)
    r.storage_status = 'failed'
    r.storage_error = { code: 'disk', message: 'x', retryable: true }
    r.images = { original: r.images.original, annotated: null }
    r.evidence.supporting_images = [r.evidence.supporting_images[0], null, r.evidence.supporting_images[2]]
    const states = Object.fromEntries(localFiles(r).map((f) => [f.name, f.state]))
    expect(states).toEqual({
      'original.jpg': 'saved',
      'annotated.jpg': 'missing',
      'result.json': 'unknown',
      'supporting/0.jpg': 'saved',
      'supporting/1.jpg': 'missing',
      'supporting/2.jpg': 'saved',
    })
  })

  it('กำลังบันทึก = pending', () => {
    const r = clone(pass)
    r.storage_status = 'pending'
    r.images = { original: null, annotated: null }
    expect(localFiles(r).slice(0, 2).map((f) => f.state)).toEqual(['pending', 'pending'])
  })
})

describe('resultFileName', () => {
  it('ใช้ id ย่อของรอบตรวจ', () => {
    expect(resultFileName(pass)).toBe('inspection-00000000.json')
  })
})
