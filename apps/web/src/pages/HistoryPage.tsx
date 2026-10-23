import { CheckCircle2, Clock3, FileText, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { InspectionDetail } from '../components/history/InspectionDetail'
import { EMPTY_HISTORY_FILTERS, HistoryFilters, type HistoryFilterValues } from '../components/history/HistoryFilters'
import { HistoryTable } from '../components/history/HistoryTable'
import { DemoTag, ResultBadge } from '../components/ResultBadge'
import { StatCard } from '../components/StatCard'
import { describeApiError, isAbort } from '../lib/api'
import { useAppData } from '../lib/AppData'
import type { InspectionPage, InspectionResult, InspectionResultValue } from '../types/inspection'

const PAGE_SIZE = 20

type Filters = HistoryFilterValues
const EMPTY_FILTERS = EMPTY_HISTORY_FILTERS

function clean(f: Filters) {
  return {
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
    source_mode: f.source_mode || undefined,
    result: f.result || undefined,
    product_id: f.product_id || undefined,
    demo: f.demo === 'true' ? true : f.demo === 'false' ? false : undefined,
    q: f.q.trim() || undefined,
    sort_by: 'created_at' as const,
    sort_order: f.sort_order,
  }
}

type Counts = Record<'total' | InspectionResultValue, number | null>

export function HistoryPage() {
  const { ds, source, products } = useAppData()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InspectionPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Counts>({ total: null, PASS: null, FAIL: null, REVIEW: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const dateInvalid = !!filters.date_from && !!filters.date_to && filters.date_from > filters.date_to

  // รายการหน้าปัจจุบัน
  useEffect(() => {
    if (dateInvalid) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    ds.listInspections({ ...clean(filters), page, page_size: PAGE_SIZE }, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setData(d)
        setSelectedId((cur) => (cur && d.items.some((i) => i.inspection_id === cur) ? cur : (d.items[0]?.inspection_id ?? null)))
      })
      .catch((e) => {
        if (!isAbort(e)) {
          setError(describeApiError(e))
          setData(null)
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [ds, filters, page, tick, dateInvalid])

  // สถิติจากข้อมูลจริง: ใช้ total ของแต่ละผลตาม filter เดียวกัน (ไม่ hardcode)
  useEffect(() => {
    if (dateInvalid) return
    const ctrl = new AbortController()
    const base = { ...clean(filters), result: undefined, page: 1, page_size: 1 }
    const keys: Array<'total' | InspectionResultValue> = ['total', 'PASS', 'FAIL', 'REVIEW']
    setCounts({ total: null, PASS: null, FAIL: null, REVIEW: null })
    Promise.all(keys.map((k) => ds.listInspections(k === 'total' ? base : { ...base, result: k }, ctrl.signal)))
      .then((pages) => { if (!ctrl.signal.aborted) setCounts({ total: pages[0].total, PASS: pages[1].total, FAIL: pages[2].total, REVIEW: pages[3].total }) })
      .catch(() => {
        /* แสดง — เมื่อดึงไม่ได้ ข้อผิดพลาดหลักแสดงที่ตาราง */
      })
    return () => ctrl.abort()
  }, [ds, filters, tick, dateInvalid])

  // เปลี่ยนแหล่งข้อมูลแล้วเริ่มหน้าแรก
  useEffect(() => {
    setPage(1)
    setSelectedId(null)
  }, [ds])

  function update<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }

  const selected = data?.items.find((i) => i.inspection_id === selectedId) ?? null
  const replace = useCallback((r: InspectionResult) => {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.inspection_id === r.inspection_id ? r : i)) } : d))
  }, [])

  const csvUrl = ds.exportCsvUrl(clean(filters))

  return (
    <div className="history-layout">
      <div className="history-main">
        <div className="page-head">
          <div>
            <h1>Inspection history</h1>
            <p>Images, results and local records</p>
          </div>
          {source === 'demo' && <DemoTag />}
        </div>

        <div className="stats">
          <StatCard tone="total" icon={<FileText size={22} />} label="Total" value={counts.total} />
          <StatCard tone="pass" icon={<CheckCircle2 size={22} />} label="Passed" value={counts.PASS} />
          <StatCard tone="fail" icon={<XCircle size={22} />} label="Failed" value={counts.FAIL} />
          <StatCard tone="review" icon={<Clock3 size={22} />} label="Review" value={counts.REVIEW} />
        </div>

        <HistoryFilters
          value={filters}
          onChange={update}
          products={products}
          csvUrl={csvUrl}
          csvDisabledReason={source === 'demo' ? 'CSV ต้องมาจาก Backend จริง ใช้ไม่ได้ในโหมด DEMO' : 'ยังไม่ได้ตั้ง VITE_API_BASE_URL จึงยังไม่มี Backend ให้ส่งออก'}
          dateInvalid={dateInvalid}
        />

        {error ? (
          <div className="panel">
            <div className="empty-state" role="alert">
              <ResultBadge result="ERROR" />
              <span>โหลดประวัติไม่สำเร็จ: {error}</span>
              <button className="btn" onClick={() => setTick((t) => t + 1)}>
                <RefreshCw size={16} aria-hidden="true" /> โหลดใหม่
              </button>
            </div>
          </div>
        ) : (
          <HistoryTable
            data={data}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            products={products}
            page={page}
            sortOrder={filters.sort_order}
            onPage={setPage}
            onClearFilters={() => setFilters(EMPTY_FILTERS)}
          />
        )}
      </div>

      <aside className="panel history-detail" aria-label="รายละเอียดการตรวจที่เลือก">
        {selected ? (
          <InspectionDetail key={selected.inspection_id} r={selected} onUpdate={replace} />
        ) : (
          <p className="hint">{loading ? 'กำลังโหลด…' : 'เลือกรายการในตารางเพื่อดูภาพและรายละเอียด'}</p>
        )}
      </aside>
    </div>
  )
}
