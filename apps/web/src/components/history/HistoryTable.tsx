import { ArrowDown, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Inbox, XCircle } from 'lucide-react'
import { formatSimilarity, formatThaiDateTime, MODE_LABEL, productShortName, REASON_LABEL, REASON_SHORT, STORAGE_LABEL } from '../../lib/format'
import type { InspectionPage, Product, StorageStatus } from '../../types/inspection'
import { DemoTag, ResultBadge } from '../ResultBadge'

const SAVED_ICON: Record<StorageStatus, typeof CheckCircle2> = { saved: CheckCircle2, pending: Clock3, failed: XCircle }

interface Props {
  data: InspectionPage | null
  loading: boolean
  selectedId: string | null
  onSelect(id: string): void
  products: Product[]
  page: number
  onPage(page: number): void
  onClearFilters(): void
}

/** ตารางประวัติตามภาพต้นแบบ: Time / Mode / Product / Result / Reason / Match score / Saved */
export function HistoryTable({ data, loading, selectedId, onSelect, products, page, onPage, onClearFilters }: Props) {
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="history-table">
      <div className="table-wrap" aria-busy={loading}>
        <table>
          <caption className="visually-hidden">รายการตรวจ เรียงจากใหม่ไปเก่า เลือกแถวเพื่อดูรายละเอียดด้านขวา</caption>
          <thead>
            <tr>
              {/* Backend เรียง created_at ใหม่ → เก่าเสมอ; การเปลี่ยนลำดับรอ API sort จากงาน 04 */}
              <th scope="col" aria-sort="descending" title="เรียงจากใหม่ไปเก่า">
                <span className="th-sort">
                  Time <ArrowDown size={14} aria-hidden="true" />
                </span>
              </th>
              <th scope="col">Mode</th>
              <th scope="col">Product</th>
              <th scope="col">Result</th>
              <th scope="col">Reason</th>
              <th scope="col" className="num">
                Match score
              </th>
              <th scope="col" className="center">
                Saved
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => {
              const Saved = SAVED_ICON[r.storage_status]
              return (
                <tr key={r.inspection_id} aria-selected={r.inspection_id === selectedId} onClick={() => onSelect(r.inspection_id)}>
                  <td>
                    <button className="rowbtn" onClick={() => onSelect(r.inspection_id)} aria-label={`ดูรายละเอียด ${formatThaiDateTime(r.created_at)}`}>
                      {formatThaiDateTime(r.created_at)}
                    </button>
                  </td>
                  <td>
                    <span className="cell-mode">
                      {MODE_LABEL[r.source_mode]}
                      {(r.demo || r.is_demo) && <DemoTag />}
                    </span>
                  </td>
                  <td>{productShortName(products, r.expected_product)}</td>
                  <td>
                    <ResultBadge result={r.result} />
                  </td>
                  <td title={REASON_LABEL[r.reason]}>{REASON_SHORT[r.reason] ?? r.reason}</td>
                  <td className="num">{formatSimilarity(r.match_score)}</td>
                  <td className={`center saved-${r.storage_status}`} title={STORAGE_LABEL[r.storage_status]}>
                    <Saved size={18} aria-hidden="true" />
                    <span className="visually-hidden">{STORAGE_LABEL[r.storage_status]}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && data && data.items.length === 0 && (
          <div className="empty-state">
            <Inbox size={30} aria-hidden="true" />
            <span>ยังไม่มีรายการที่ตรงตัวกรอง ลองล้างตัวกรอง หรือเริ่มตรวจจากหน้า Simulation / Webcam</span>
            <button className="btn btn-sm" onClick={onClearFilters}>
              ล้างตัวกรอง
            </button>
          </div>
        )}
        {loading && !data && (
          <div className="stack-sm" style={{ padding: 16 }}>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" style={{ width: '60%' }} />
          </div>
        )}
      </div>
      <div className="pager">
        <span>{data ? `${data.total} รายการ หน้า ${data.page}/${pages}` : 'กำลังโหลด…'}</span>
        <div className="row">
          <button className="btn btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1 || loading}>
            <ChevronLeft size={15} aria-hidden="true" /> ก่อนหน้า
          </button>
          <button className="btn btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages || loading}>
            ถัดไป <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
