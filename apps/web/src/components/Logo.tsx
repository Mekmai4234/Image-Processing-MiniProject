/** โลโก้เดียวของ Vending Vision ใช้ทุกหน้า (รวมจากภาพต้นแบบทั้งสาม: เลนส์กล้องตรวจฉลาก) */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--cyan)" strokeWidth="2.6" />
      <path d="M16 3a13 13 0 0 1 11.3 6.5" fill="none" stroke="var(--text)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="7" fill="var(--panel-2)" stroke="var(--cyan)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.6" fill="var(--text)" />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand-name">
      VENDING <span>VISION</span>
    </span>
  )
}
