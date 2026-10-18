import { useEffect } from 'react'
import { useAppData } from '../lib/AppData'

/** สินค้าที่คาดหวังมาจาก catalog เท่านั้น */
export function ProductSelect({ value, onChange, disabled }: { value: string; onChange(v: string): void; disabled?: boolean }) {
  const { products, catalogError } = useAppData()
  return (
    <label className="field">
      สินค้าที่คาดหวัง
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || products.length === 0}>
        {products.length === 0 && <option value="">{catalogError ? 'โหลด catalog ไม่ได้' : 'กำลังโหลด catalog…'}</option>}
        {products.map((p) => (
          <option key={p.product_id} value={p.product_id}>
            {p.display_name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** เลือกสินค้าแรกใน catalog อัตโนมัติเมื่อยังไม่ได้เลือกหรือค่าเดิมหายไป */
export function useDefaultProduct(current: string, set: (v: string) => void) {
  const { products } = useAppData()
  useEffect(() => {
    if (products.length > 0 && !products.some((p) => p.product_id === current)) set(products[0].product_id)
  }, [products, current, set])
}
