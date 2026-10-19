import { describe, expect, it } from 'vitest'
import { buildInspectionForm } from './api'
import { appendViews, buildSimulationRequest, removeView, setViewAngle, type ViewItem } from './views'

const blob = new Blob(['x'], { type: 'image/jpeg' })
const upload = (id: string): ViewItem => ({ id, blob, name: `${id}.jpg`, angle: null })

describe('มุมภาพที่ไม่ทราบต้องเป็น null (review 01-1)', () => {
  it('ภาพอัปโหลดใหม่ยังไม่มีมุมจนผู้ใช้เลือก', () => {
    const { views } = appendViews([], [upload('a'), upload('b'), upload('c')], 12)
    expect(views.map((v) => v.angle)).toEqual([null, null, null])
  })

  it('เลือก "ไม่ทราบมุม" แล้วเพิ่มภาพใหม่ ภาพเดิมยังเป็น null', () => {
    let views = appendViews([], [upload('a'), upload('b')], 12).views
    views = setViewAngle(views, 'a', 90)
    views = setViewAngle(views, 'a', null) // ผู้ใช้เปลี่ยนกลับเป็นไม่ทราบมุม
    views = appendViews(views, [upload('c')], 12).views
    expect(views.map((v) => [v.id, v.angle])).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
    ])
  })

  it('เพิ่มและลบภาพแล้วมุมที่ผู้ใช้เลือกไว้คงเดิม', () => {
    let views = appendViews([], [upload('a'), upload('b'), upload('c')], 12).views
    views = setViewAngle(views, 'b', 180)
    views = removeView(views, 'a')
    views = appendViews(views, [upload('d')], 12).views
    expect(views.map((v) => [v.id, v.angle])).toEqual([
      ['b', 180],
      ['c', null],
      ['d', null],
    ])
  })

  it('เกินจำนวนสูงสุดตัดเฉพาะภาพใหม่', () => {
    const r = appendViews([upload('a')], [upload('b'), upload('c')], 2)
    expect(r.views.map((v) => v.id)).toEqual(['a', 'b'])
    expect(r.dropped).toBe(1)
  })

  it('ภาพหลักไม่ทราบมุมไม่ส่ง angle_deg และภาพสนับสนุนใช้ null ตามลำดับ', () => {
    const views = setViewAngle([upload('a'), upload('b'), upload('c')], 'c', 270)
    const req = buildSimulationRequest(views, 'a', 'bottle_a', '10000000-0000-4000-8000-0000000000dd')!
    expect(req.angle_deg).toBeUndefined()
    expect(req.evidence?.supporting_angles_deg).toEqual([null, 270])
    const form = buildInspectionForm(req)
    expect(form.has('angle_deg')).toBe(false)
    expect(JSON.parse(String(form.get('evidence'))).supporting_angles_deg).toEqual([null, 270])
  })

  it('ภาพหลักที่ผู้ใช้เลือกมุมแล้วส่ง angle_deg ตามนั้น', () => {
    const views = setViewAngle([upload('a'), upload('b')], 'b', 0)
    const req = buildSimulationRequest(views, 'b', 'bottle_a', '10000000-0000-4000-8000-0000000000ee')!
    expect(req.angle_deg).toBe(0)
    expect(req.evidence?.supporting_angles_deg).toEqual([null])
  })

  it('ภาพเดียวเป็น single view ไม่ส่ง evidence', () => {
    const req = buildSimulationRequest([upload('a')], null, 'bottle_a', '10000000-0000-4000-8000-0000000000ff')!
    expect(req.evidence).toBeUndefined()
    expect(req.supporting_images).toBeUndefined()
  })
})
