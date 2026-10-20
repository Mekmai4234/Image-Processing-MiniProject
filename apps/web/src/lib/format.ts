import type {
  InspectionReason,
  InspectionResultValue,
  LocatorReason,
  Product,
  SourceMode,
  StorageStatus,
} from '../types/inspection'
import { APP_TIMEZONE } from './config'

export const RESULT_LABEL: Record<InspectionResultValue, string> = {
  PASS: 'ผ่าน',
  FAIL: 'ไม่ผ่าน',
  REVIEW: 'รอตรวจทาน',
}

export const REASON_LABEL: Record<InspectionReason, string> = {
  good: 'ฉลากถูกต้องและอยู่ตำแหน่ง',
  wrong_label: 'ฉลากผิดสินค้า',
  misplaced_label: 'ฉลากผิดตำแหน่ง',
  missing_label: 'ไม่มีฉลาก (ยืนยันจากหลักฐานหลายมุม)',
  blurred_image: 'ภาพเบลอ',
  label_not_visible: 'มองไม่เห็นฉลาก',
  unknown_product: 'ไม่รู้จักสินค้า',
  ambiguous_match: 'ผลเทียบสูสี ตัดสินไม่ได้',
  orientation_failed: 'หามุมฉลากไม่สำเร็จ',
}

export const LOCATOR_LABEL: Record<LocatorReason, string> = {
  usable_view: 'พบฉลาก ถือขวดนิ่ง ๆ',
  blurred_image: 'ภาพเบลอ ถือขวดนิ่งขึ้น',
  label_not_visible: 'ยังไม่เห็นฉลาก หมุนขวดช้า ๆ',
  orientation_failed: 'ถอยขวดออกให้เห็นทั้งขวด',
}

export const MODE_LABEL: Record<SourceMode, string> = {
  simulation: 'Simulation',
  webcam: 'Webcam',
}

export const STORAGE_LABEL: Record<StorageStatus, string> = {
  pending: 'กำลังบันทึก',
  saved: 'บันทึกแล้ว',
  failed: 'บันทึกไม่สำเร็จ',
}

/** match_score เป็น similarity 0..1 หรือ null → "—" ห้ามเรียกว่า confidence */
export function formatSimilarity(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—'
  return `${Math.round(score * 100)}%`
}

const dateTime = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** created_at เป็น UTC → แสดงเวลาไทย */
export function formatThaiDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d)
}

/** วันที่วันนี้ตามเวลาไทยในรูปแบบ YYYY-MM-DD สำหรับ filter */
export function todayInBangkok(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(now)
}

export function productName(products: Product[], id: string | null | undefined): string {
  if (!id) return '—'
  return products.find((p) => p.product_id === id)?.display_name ?? id
}

/** ชื่อสั้นสำหรับตาราง: ตัดส่วนหลัง " — " ออก */
export function productShortName(products: Product[], id: string | null | undefined): string {
  return productName(products, id).split(' — ')[0]
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} วิ` : `${Math.round(ms)} ms`
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}
