import { describe, expect, it } from 'vitest'
import { webcamGuidance } from '../guidance'
import type { LocateResult } from '../../../types/inspection'

function locator(overrides: Partial<LocateResult> = {}): LocateResult {
  return { usable_view: false, bbox: null, image_width: 640, image_height: 360,
    reason: 'orientation_failed', quality: { bottle_visible: false, label_visible: false, sharp_enough: false }, ...overrides }
}

describe('live label guidance', () => {
  it('does not call missing foreground a blurred image', () => {
    const guidance = webcamGuidance(locator())
    expect(guidance.text).not.toContain('เบลอ')
    expect(guidance.text).toContain('ค้นหาฉลาก')
    expect(guidance.readyToCapture).toBe(false)
  })
  it('permits a sharp matching label without the entire bottle', () => {
    const guidance = webcamGuidance(locator({ usable_view: true, reason: 'usable_view',
      quality: { bottle_visible: false, label_visible: true, sharp_enough: true } }))
    expect(guidance.readyToCapture).toBe(true)
  })
  it('requires a real blur measurement or a detected blurry label for blur advice', () => {
    expect(webcamGuidance(locator({ reason: 'blurred_image' })).text).toContain('ไม่คมชัด')
    expect(webcamGuidance(locator({ quality: { bottle_visible: false, label_visible: true, sharp_enough: false } })).readyToCapture).toBe(false)
  })
})
