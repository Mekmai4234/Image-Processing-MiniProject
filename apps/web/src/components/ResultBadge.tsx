import { AlertOctagon, CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { RESULT_LABEL } from '../lib/format'
import type { InspectionResultValue } from '../types/inspection'

type Tone = InspectionResultValue | 'ERROR'

const ICON = { PASS: CheckCircle2, FAIL: XCircle, REVIEW: Clock3, ERROR: AlertOctagon }

/** สีอย่างเดียวไม่พอ: มีไอคอน + รหัสผล + คำไทยเสมอ */
export function ResultBadge({ result, size }: { result: Tone; size?: 'lg' }) {
  const Icon = ICON[result]
  const text = result === 'ERROR' ? 'ระบบขัดข้อง' : RESULT_LABEL[result]
  return (
    <span className={`badge ${result} ${size ?? ''}`}>
      <Icon size={size === 'lg' ? 18 : 14} aria-hidden="true" />
      {result}
      <span className="visually-hidden"> {text}</span>
    </span>
  )
}

export function DemoTag({ title = 'ข้อมูลสังเคราะห์ ไม่ใช่ผลตรวจจริง' }: { title?: string }) {
  return (
    <span className="demo-tag" title={title}>
      DEMO
    </span>
  )
}
