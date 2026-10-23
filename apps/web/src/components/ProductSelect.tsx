import { useEffect } from 'react'
import { useAppData } from '../lib/AppData'

/** สินค้าที่คาดหวังมาจาก catalog เท่านั้น */
export function ProductSelect(_props: { value: string; onChange(v: string): void; disabled?: boolean }) {
  const { products, catalogError } = useAppData()
  return <div className="field"><span>สินค้าอ้างอิง</span><strong>{products[0]?.display_name ?? (catalogError ? 'โหลดสินค้าอ้างอิงไม่ได้' : 'กำลังโหลดสินค้าอ้างอิง…')}</strong></div>
}

/** เลือกสินค้าแรกใน catalog อัตโนมัติเมื่อยังไม่ได้เลือกหรือค่าเดิมหายไป */
export function useDefaultProduct(current: string, set: (v: string) => void) {
  const { products } = useAppData()
  useEffect(() => {
    if (products.length > 0 && products[0].product_id !== current) set(products[0].product_id)
  }, [products, current, set])
}
