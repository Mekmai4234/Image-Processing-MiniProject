// ภาพสังเคราะห์สำหรับโหมด DEMO เท่านั้น — วาดขวดให้ตรงพิกัดใน examples/*.json
// ไม่ได้มาจากการตรวจภาพจริง และไม่ใช้แทน original ในตัวตรวจ
import type { BBox, InspectionResult } from '../types/inspection'

const COLORS = { PASS: '#34D399', FAIL: '#F87171', REVIEW: '#FBBF24' } as const

type LabelStyle = 'a' | 'b' | 'back' | 'none'

function labelFor(r: InspectionResult): LabelStyle {
  if (r.reason === 'orientation_failed' || r.reason === 'label_not_visible') return 'back'
  if (r.reason === 'missing_label') return 'none'
  if (r.detected_product && r.detected_product !== r.expected_product) return 'b'
  return 'a'
}

function labelSvg(style: LabelStyle, box: BBox): string {
  const { x, y, width: w, height: h } = box
  if (style === 'none') return ''
  if (style === 'back') {
    // เห็นแค่ขอบฉลากด้านหลัง
    return `<rect x="${x + w - 18}" y="${y}" width="16" height="${h}" fill="#1d4ed8" opacity=".75"/>`
  }
  const base = style === 'a' ? '#e8f1fb' : '#fff3e6'
  const wave1 = style === 'a' ? '#2563eb' : '#ea580c'
  const wave2 = style === 'a' ? '#60a5fa' : '#fb923c'
  const name = style === 'a' ? 'BOTTLE A' : 'BOTTLE B'
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${base}"/>
    <path d="M${x} ${y + h * 0.62} C ${x + w * 0.3} ${y + h * 0.35}, ${x + w * 0.6} ${y + h * 0.95}, ${x + w} ${y + h * 0.5} L ${x + w} ${y + h} L ${x} ${y + h} Z" fill="${wave1}"/>
    <path d="M${x} ${y + h * 0.78} C ${x + w * 0.35} ${y + h * 0.55}, ${x + w * 0.65} ${y + h * 1.05}, ${x + w} ${y + h * 0.72} L ${x + w} ${y + h} L ${x} ${y + h} Z" fill="${wave2}" opacity=".85"/>
    <text x="${x + w / 2}" y="${y + h * 0.33}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${Math.round(h * 0.2)}" fill="${wave1}">${name}</text>`
}

function boxSvg(b: BBox, color: string, dashed: boolean): string {
  return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="${color}" stroke-width="4" ${dashed ? 'stroke-dasharray="10 7"' : ''}/>`
}

export interface SyntheticOptions {
  annotated?: boolean
  /** มุมภาพหลักฐานเพิ่มเติม ใช้เปลี่ยนตำแหน่งฉลากให้ดูหมุน */
  angle?: number
}

export function syntheticImage(r: InspectionResult, opts: SyntheticOptions = {}): string {
  const W = r.image_width
  const H = r.image_height
  const fallback: BBox = r.expected_bbox ?? { x: W * 0.3, y: H * 0.36, width: W * 0.4, height: H * 0.2 }
  let style = labelFor(r)
  let label = r.bbox ?? fallback
  if (opts.angle !== undefined) {
    // ภาพหลักฐานรอบขวด: ฉลากเลื่อนออกด้านข้างตามมุม
    style = r.reason === 'missing_label' ? 'none' : 'back'
    label = { ...fallback, x: fallback.x + ((opts.angle / 90) % 2) * 20 }
  }
  const blur = r.reason === 'blurred_image'
  const cx = W / 2
  const bodyW = W * 0.45
  const bodyTop = H * 0.24
  const annotations = opts.annotated
    ? [
        r.expected_bbox && (r.bbox === null || r.reason === 'misplaced_label') ? boxSvg(r.expected_bbox, COLORS[r.result], true) : '',
        r.bbox ? boxSvg(r.bbox, COLORS[r.result], false) : '',
      ].join('')
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd6de"/><stop offset=".72" stop-color="#e9edf1"/><stop offset=".72" stop-color="#b9a58a"/><stop offset="1" stop-color="#a08b6f"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".25"/><stop offset=".25" stop-color="#ffffff" stop-opacity=".75"/><stop offset=".6" stop-color="#dbeafe" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity=".2"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="${blur ? 6 : 0}"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g filter="url(#blur)">
    <rect x="${cx - W * 0.07}" y="${H * 0.06}" width="${W * 0.14}" height="${H * 0.07}" rx="5" fill="#1e40af"/>
    <path d="M${cx - W * 0.08} ${H * 0.13} L ${cx + W * 0.08} ${H * 0.13} L ${cx + bodyW / 2} ${bodyTop} L ${cx - bodyW / 2} ${bodyTop} Z" fill="url(#glass)" stroke="#94a3b8" stroke-opacity=".6"/>
    <rect x="${cx - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${H * 0.7}" rx="${W * 0.06}" fill="url(#glass)" stroke="#94a3b8" stroke-opacity=".6"/>
    ${labelSvg(style, label)}
  </g>
  ${annotations}
  <text x="10" y="${H - 12}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#7c2d12">DEMO: ภาพสังเคราะห์</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
