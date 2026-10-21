import type { ReactNode } from 'react'

export type StatTone = 'total' | 'pass' | 'fail' | 'review'

interface StatCardProps {
  tone: StatTone
  label: string
  /** null = ยังไม่มีข้อมูล แสดง "—" ไม่แสดง 0 ที่ชวนเข้าใจผิด */
  value: number | null
  icon?: ReactNode
  /** บรรทัดเล็กใต้ตัวเลข เช่น สัดส่วน */
  hint?: ReactNode
}

/** การ์ดตัวเลขสรุปที่ใช้ร่วมกันทุกหน้า สีมาจาก tone และมีคำกำกับเสมอ ไม่พึ่งสีอย่างเดียว */
export function StatCard({ tone, label, value, icon, hint }: StatCardProps) {
  return (
    <div className={`stat ${tone}`}>
      {icon && (
        <span className="icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div>
        <div className="k">{label}</div>
        <div className="v">{value ?? '—'}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  )
}
