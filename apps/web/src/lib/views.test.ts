import { describe, expect, it } from 'vitest'
import { toJobInput } from '../features/simulation/jobInput'
import { appendViews, removeView, setViewAngle, type ViewItem } from './views'

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

  it('ส่งต่อให้ฉากของ 02 โดยไม่เดามุม: null คงเป็น null ตามลำดับเดิม', () => {
    const views = setViewAngle([upload('a'), upload('b'), upload('c')], 'c', 270)
    const job = toJobInput('bottle_a', views)
    expect(job.views.map((v) => v.angle_deg)).toEqual([null, null, 270])
    expect(job.views.map((v) => v.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })
})
