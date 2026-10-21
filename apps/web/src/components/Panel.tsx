import { useId, type ReactNode } from 'react'

interface PanelProps {
  title: ReactNode
  /** ไอคอนหน้าหัวข้อ (สี cyan) */
  icon?: ReactNode
  subtitle?: ReactNode
  /** ปุ่ม/ป้ายด้านขวาของหัวข้อ */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** เปลี่ยนเป็น aside สำหรับแถบรายละเอียดด้านขวา */
  as?: 'section' | 'aside'
}

/** กล่องเนื้อหามาตรฐานของทุกหน้า: หัวข้อ + คำอธิบาย + ปุ่มด้านขวา ใช้ตัวนี้แทนการเขียน .panel เอง */
export function Panel({ title, icon, subtitle, actions, children, className = '', as: Tag = 'section' }: PanelProps) {
  const id = useId()
  return (
    <Tag className={`panel ${className}`} aria-labelledby={id}>
      <div className="panel-head">
        <div>
          <div className="title">
            {icon && <span aria-hidden="true">{icon}</span>}
            <h2 id={id}>{title}</h2>
          </div>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </Tag>
  )
}
