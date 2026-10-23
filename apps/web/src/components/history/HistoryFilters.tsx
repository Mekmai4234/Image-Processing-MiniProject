import { Download, Search } from 'lucide-react'
import type { Product, InspectionResultValue, SourceMode } from '../../types/inspection'
import { productShortName } from '../../lib/format'

export interface HistoryFilterValues {
  date_from: string
  date_to: string
  source_mode: '' | SourceMode
  result: '' | InspectionResultValue
  product_id: string
  demo: '' | 'true' | 'false'
  q: string
  sort_order: 'asc' | 'desc'
}

export const EMPTY_HISTORY_FILTERS: HistoryFilterValues = { date_from: '', date_to: '', source_mode: '', result: '', product_id: '', demo: '', q: '', sort_order: 'desc' }

interface Props {
  value: HistoryFilterValues
  onChange<K extends keyof HistoryFilterValues>(key: K, v: HistoryFilterValues[K]): void
  products: Product[]
  /** null = ส่งออกไม่ได้ (DEMO หรือยังไม่ตั้ง API) */
  csvUrl: string | null
  csvDisabledReason: string
  dateInvalid: boolean
}

/** ตัวกรองตามภาพต้นแบบ: Date range / Mode / Result / Product / Search / Export CSV — ใช้ชุดเดียวกับตาราง สถิติ และ CSV */
export function HistoryFilters({ value, onChange, products, csvUrl, csvDisabledReason, dateInvalid }: Props) {
  return (
    <section className="panel history-filters" aria-label="ตัวกรองประวัติ">
      <fieldset className="field date-range">
        <legend>Date range</legend>
        <div className="date-pair">
          <input type="date" aria-label="ตั้งแต่วันที่" value={value.date_from} max={value.date_to || undefined} onChange={(e) => onChange('date_from', e.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="date" aria-label="ถึงวันที่" value={value.date_to} min={value.date_from || undefined} onChange={(e) => onChange('date_to', e.target.value)} />
        </div>
      </fieldset>
      <label className="field">
        Mode
        <select value={value.source_mode} onChange={(e) => onChange('source_mode', e.target.value as HistoryFilterValues['source_mode'])}>
          <option value="">All modes</option>
          <option value="simulation">Simulation</option>
          <option value="webcam">Webcam</option>
        </select>
      </label>
      <label className="field">
        Result
        <select value={value.result} onChange={(e) => onChange('result', e.target.value as HistoryFilterValues['result'])}>
          <option value="">All results</option>
          <option value="PASS">PASS</option>
          <option value="FAIL">FAIL</option>
          <option value="REVIEW">REVIEW</option>
        </select>
      </label>
      <label className="field">
        Product
        <select value={value.product_id} onChange={(e) => onChange('product_id', e.target.value)}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {productShortName(products, p.product_id)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Data
        <select value={value.demo} onChange={(e) => onChange('demo', e.target.value as HistoryFilterValues['demo'])}>
          <option value="">จริงและ DEMO</option>
          <option value="false">เฉพาะผลตรวจจริง</option>
          <option value="true">เฉพาะ DEMO</option>
        </select>
      </label>
      <label className="field search">
        <span className="visually-hidden">Search inspections</span>
        <span className="search-box">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search inspections" placeholder="Search inspections…" value={value.q} onChange={e=>onChange('q',e.target.value)} />
        </span>
      </label>
      {csvUrl ? (
        <a className="btn btn-primary export" href={csvUrl} download>
          <Download size={16} aria-hidden="true" /> Export CSV
        </a>
      ) : (
        <button className="btn export" disabled title={csvDisabledReason}>
          <Download size={16} aria-hidden="true" /> Export CSV
        </button>
      )}
      <p id="search-note" className="hint filters-note">
        <label>ลำดับเวลา <select aria-label="ลำดับเวลา" value={value.sort_order} onChange={e=>onChange('sort_order',e.target.value as 'asc'|'desc')}><option value="desc">ใหม่ → เก่า</option><option value="asc">เก่า → ใหม่</option></select></label>
      </p>
      {dateInvalid && (
        <p className="hint filters-note" role="alert">
          วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด
        </p>
      )}
    </section>
  )
}
