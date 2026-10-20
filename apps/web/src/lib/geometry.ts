import type { BBox } from '../types/inspection'

export interface ContainTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * object-fit: contain
 * scale = min(W/Iw, H/Ih); offset = พื้นที่ว่างครึ่งหนึ่งของแต่ละแกน
 * W,H = กล่องแสดงผล (CSS px) / Iw,Ih = ภาพต้นฉบับ (image px)
 */
export function containTransform(boxW: number, boxH: number, imgW: number, imgH: number): ContainTransform {
  if (!(boxW > 0 && boxH > 0 && imgW > 0 && imgH > 0)) return { scale: 0, offsetX: 0, offsetY: 0 }
  const scale = Math.min(boxW / imgW, boxH / imgH)
  return {
    scale,
    offsetX: (boxW - imgW * scale) / 2,
    offsetY: (boxH - imgH * scale) / 2,
  }
}

/**
 * แปลงกรอบจาก image px เป็น CSS px ในกล่องแสดงผล
 * mirror=true ใช้เมื่อภาพที่แสดงถูกกลับซ้ายขวา (เช่น preview กล้องหน้า) ต้องกลับกรอบตามด้วย
 */
export function mapBox(box: BBox, t: ContainTransform, imgW: number, mirror = false): BBox {
  const x = mirror ? imgW - box.x - box.width : box.x
  return {
    x: x * t.scale + t.offsetX,
    y: box.y * t.scale + t.offsetY,
    width: box.width * t.scale,
    height: box.height * t.scale,
  }
}

/** พื้นที่ภาพจริงภายในกล่อง (ใช้วาดขอบภาพ/letterbox) */
export function imageRect(t: ContainTransform, imgW: number, imgH: number): BBox {
  return { x: t.offsetX, y: t.offsetY, width: imgW * t.scale, height: imgH * t.scale }
}
