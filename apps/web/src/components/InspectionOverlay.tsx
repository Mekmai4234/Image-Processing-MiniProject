import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { containTransform, imageRect, mapBox } from '../lib/geometry'
import { formatSimilarity } from '../lib/format'
import type { BBox, InspectionResult, InspectionResultValue } from '../types/inspection'

const TONE: Record<InspectionResultValue | 'LOCATOR', string> = {
  PASS: 'var(--pass)',
  FAIL: 'var(--fail)',
  REVIEW: 'var(--review)',
  LOCATOR: 'var(--cyan)',
}

interface Props {
  /** ภาพที่ใช้ตรวจจริง (หรือภาพ DEMO ที่ตรงพิกัด) */
  src: string | null
  /** ขนาดภาพจาก API หลังแก้ EXIF; ถ้าไม่ส่งใช้ naturalWidth/Height */
  imageWidth?: number
  imageHeight?: number
  /** ผลตรวจจาก backend: bbox = ฉลากที่พบ, expected_bbox = บริเวณคาดหวัง (เส้นประ) */
  result?: InspectionResult | null
  /** กรอบจาก locator ก่อนตรวจ (ยังไม่ใช่ผล PASS/FAIL) */
  locatorBox?: BBox | null
  /** ภาพที่แสดงถูก mirror หรือไม่ (กรอบจะถูก mirror ตาม) */
  mirror?: boolean
  scanning?: boolean
  status?: ReactNode
  empty?: ReactNode
  className?: string
  alt: string
  showReadout?: boolean
  /** ภาพย่อ: ไม่แสดงป้ายข้อความบนกรอบ */
  compact?: boolean
}

/** วาดกรอบบน SVG แยกจากภาพต้นฉบับ ไม่วาดทับภาพจริง */
export function InspectionOverlay({
  src,
  imageWidth,
  imageHeight,
  result,
  locatorBox,
  mirror = false,
  scanning = false,
  status,
  empty,
  className = '',
  alt,
  showReadout = true,
  compact = false,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => setNatural(null), [src])

  const Iw = result?.image_width ?? imageWidth ?? natural?.w ?? 0
  const Ih = result?.image_height ?? imageHeight ?? natural?.h ?? 0
  const t = containTransform(size.w, size.h, Iw, Ih)
  const ready = !!src && t.scale > 0

  const boxes: Array<{ key: string; box: BBox; color: string; dashed: boolean; label: string }> = []
  if (ready && result) {
    const color = TONE[result.result]
    // expected_bbox = บริเวณคาดหวัง แสดงเมื่อไม่พบฉลากหรือฉลากผิดตำแหน่ง ห้ามแสดงเป็นฉลากที่พบ
    if (result.expected_bbox && (!result.bbox || result.reason === 'misplaced_label')) {
      boxes.push({ key: 'expected', box: result.expected_bbox, color, dashed: true, label: 'บริเวณที่ควรมีฉลาก' })
    }
    if (result.bbox) {
      const score = result.match_score === null ? '' : ` | คล้าย ${formatSimilarity(result.match_score)}`
      boxes.push({ key: 'bbox', box: result.bbox, color, dashed: false, label: `${result.result}${score}` })
    }
  } else if (ready && locatorBox) {
    boxes.push({ key: 'locator', box: locatorBox, color: TONE.LOCATOR, dashed: false, label: 'พบฉลาก ยังไม่ได้ตรวจ' })
  }

  const frame = ready ? imageRect(t, Iw, Ih) : null

  return (
    <div ref={boxRef} className={`viewport ${scanning ? 'scanning' : ''} ${className}`}>
      {src ? (
        <img
          src={src}
          alt={alt}
          style={mirror ? { transform: 'scaleX(-1)' } : undefined}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      ) : (
        <div className="empty">{empty}</div>
      )}

      {ready && (
        <svg className="overlay" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          {frame && (
            <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
          )}
          {boxes.map(({ key, box, color, dashed, label }) => {
            const m = mapBox(box, t, Iw, mirror)
            const labelW = Math.max(label.length * 7.4 + 14, 60)
            const above = m.y > 26
            return (
              <g key={key}>
                <rect
                  x={m.x}
                  y={m.y}
                  width={m.width}
                  height={m.height}
                  fill={dashed ? 'none' : `color-mix(in srgb, ${color} 10%, transparent)`}
                  stroke={color}
                  strokeWidth={dashed ? 2 : 2.5}
                  strokeDasharray={dashed ? '8 6' : undefined}
                />
                {!compact && (
                <g transform={`translate(${m.x}, ${above ? m.y - 24 : m.y + m.height + 4})`}>
                  <rect width={labelW} height="20" rx="3" fill={dashed ? 'rgba(4,13,25,.85)' : color} stroke={color} />
                  <text x="7" y="14" fontSize="12" fontWeight="600" fill={dashed ? color : '#04121f'} fontFamily="var(--font)">
                    {label}
                  </text>
                </g>
                )}
              </g>
            )
          })}
        </svg>
      )}

      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
      {status && <div className="status">{status}</div>}
      {ready && showReadout && (
        <div className="readout" title="ขนาดภาพต้นฉบับ และอัตราย่อที่ใช้วาดกรอบ">
          {Iw}×{Ih}px · ×{t.scale.toFixed(2)}
          {mirror ? ' · mirror' : ''}
        </div>
      )}
    </div>
  )
}
