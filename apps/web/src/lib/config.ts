// อ่านเฉพาะค่าที่ browser ต้องรู้ ห้ามส่ง environment ทั้งก้อนเข้าหน้าเว็บ
const raw = import.meta.env.VITE_API_BASE_URL as string | undefined

/** URL หลังบ้าน ไม่มี / ท้าย; ค่าว่างแปลว่ายังไม่ได้ตั้ง .env */
export const API_BASE_URL: string = (raw ?? '').trim().replace(/\/+$/, '')

export const APP_TIMEZONE = 'Asia/Bangkok'
