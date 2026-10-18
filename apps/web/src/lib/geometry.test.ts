import { describe, expect, it } from 'vitest'
import { containTransform, mapBox } from './geometry'

describe('containTransform (object-fit: contain)', () => {
  it('ภาพแนวตั้งในกล่องแนวนอน มีขอบว่างซ้ายขวา', () => {
    const t = containTransform(800, 500, 400, 500)
    expect(t.scale).toBe(1)
    expect(t.offsetX).toBe(200)
    expect(t.offsetY).toBe(0)
  })

  it('ภาพแนวนอนในกล่องแนวตั้ง มีขอบว่างบนล่าง', () => {
    const t = containTransform(300, 600, 1200, 800)
    expect(t.scale).toBeCloseTo(0.25)
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo((600 - 800 * 0.25) / 2)
  })

  it('ขนาดเป็นศูนย์ไม่คืน NaN', () => {
    expect(containTransform(0, 0, 400, 500)).toEqual({ scale: 0, offsetX: 0, offsetY: 0 })
  })
})

describe('mapBox', () => {
  const box = { x: 120, y: 180, width: 160, height: 100 }

  it('แปลงด้วย scale + offset', () => {
    const t = containTransform(800, 1000, 400, 500) // scale 2, ไม่มี offset
    expect(mapBox(box, t, 400)).toEqual({ x: 240, y: 360, width: 320, height: 200 })
  })

  it('mirror กลับแกน x ตามภาพต้นฉบับก่อน scale', () => {
    const t = containTransform(400, 500, 400, 500)
    expect(mapBox({ x: 0, y: 0, width: 100, height: 50 }, t, 400, true).x).toBe(300)
  })

  it('ย่อหน้าต่างแล้วกรอบยังสัมพันธ์กับภาพ', () => {
    const big = mapBox(box, containTransform(1000, 1000, 400, 500), 400)
    const small = mapBox(box, containTransform(500, 500, 400, 500), 400)
    expect(small.width / big.width).toBeCloseTo(0.5)
  })
})
