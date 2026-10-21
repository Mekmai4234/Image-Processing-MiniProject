import { describe, expect, it } from 'vitest'
import { readinessOf } from './readiness'

describe('readinessOf: แยก service online ออกจากความพร้อมของตัวตรวจ', () => {
  it('backend ยังไม่ส่งฟิลด์ = ยังไม่ทราบ ไม่ถือว่าพร้อม', () => {
    expect(readinessOf({ status: 'ok' })).toEqual({ detector: 'unknown', detectorReason: null, storage: 'unknown' })
  })

  it('ตัวตรวจไม่พร้อมพร้อมเหตุผล', () => {
    const r = readinessOf({ status: 'ok', detector_ready: false, detector_reason: ' ยังไม่มี reference ', storage_root_ready: true })
    expect(r).toEqual({ detector: 'not_ready', detectorReason: 'ยังไม่มี reference', storage: 'ready' })
  })

  it('ตัวตรวจพร้อมแล้วไม่แสดงเหตุผลค้าง', () => {
    expect(readinessOf({ status: 'ok', detector_ready: true, detector_reason: 'old' }).detectorReason).toBeNull()
  })

  it('ที่เก็บไฟล์เขียนไม่ได้', () => {
    expect(readinessOf({ status: 'ok', storage_root_ready: false }).storage).toBe('not_ready')
  })
})
