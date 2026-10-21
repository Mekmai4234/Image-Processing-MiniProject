import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, FileText, Inbox, RefreshCw, UserCheck, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { InspectionOverlay } from '../components/InspectionOverlay'
import { ResultDetails } from '../components/ResultCard'
import { DemoTag, ResultBadge } from '../components/ResultBadge'
import { describeApiError, isAbort } from '../lib/api'
import { useAppData } from '../lib/AppData'
import { formatSimilarity, formatThaiDateTime, MODE_LABEL, productShortName, REASON_LABEL, shortId, STORAGE_LABEL } from '../lib/format'
import {
  REASONS,
  type InspectionPage,
  type InspectionReason,
  type InspectionResult,
  type InspectionResultValue,
  type SourceMode,
} from '../types/inspection'

const PAGE_SIZE = 20

interface Filters {
  date_from: string
  date_to: string
  source_mode: '' | SourceMode
  result: '' | InspectionResultValue
  product_id: string
  demo: '' | 'true' | 'false'
}

const EMPTY_FILTERS: Filters = { date_from: '', date_to: '', source_mode: '', result: '', product_id: '', demo: '' }

function clean(f: Filters) {
  return {
    date_from: f.date_from || undefined,
    date_to: f.date_to || undefined,
    source_mode: f.source_mode || undefined,
    result: f.result || undefined,
    product_id: f.product_id || undefined,
    demo: f.demo === 'true' ? true : f.demo === 'false' ? false : undefined,
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
      .then((pages) => setCounts({ total: pages[0].total, PASS: pages[1].total, FAIL: pages[2].total, REVIEW: pages[3].total }))
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

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const csvUrl = ds.exportCsvUrl(clean(filters))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ประวัติการตรวจ</h1>
          <p>ภาพ ผลตรวจ และสถานะบันทึกจากเครื่องที่รัน Backend</p>
        </div>
        {source === 'demo' && <DemoTag />}
      </div>

      <div className="stats" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat cls="total" icon={<FileText size={20} />} label="ทั้งหมด" value={counts.total} />
        <Stat cls="pass" icon={<CheckCircle2 size={20} />} label="ผ่าน" value={counts.PASS} />
        <Stat cls="fail" icon={<XCircle size={20} />} label="ไม่ผ่าน" value={counts.FAIL} />
        <Stat cls="review" icon={<Clock3 size={20} />} label="รอตรวจทาน" value={counts.REVIEW} />
      </div>

      <div className="split split-wide">
        <div className="stack">
          <section className="panel" aria-label="ตัวกรอง">
            <div className="filters">
              <label className="field">
                ตั้งแต่วันที่
                <input type="date" value={filters.date_from} onChange={(e) => update('date_from', e.target.value)} />
              </label>
              <label className="field">
                ถึงวันที่
                <input type="date" value={filters.date_to} onChange={(e) => update('date_to', e.target.value)} />
              </label>
              <label className="field">
                โหมด
                <select value={filters.source_mode} onChange={(e) => update('source_mode', e.target.value as Filters['source_mode'])}>
                  <option value="">ทุกโหมด</option>
                  <option value="simulation">Simulation</option>
                  <option value="webcam">Webcam</option>
                </select>
              </label>
              <label className="field">
                ผลตรวจ
                <select value={filters.result} onChange={(e) => update('result', e.target.value as Filters['result'])}>
                  <option value="">ทุกผล</option>
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                  <option value="REVIEW">REVIEW</option>
                </select>
              </label>
              <label className="field">
                สินค้าที่คาดหวัง
                <select value={filters.product_id} onChange={(e) => update('product_id', e.target.value)}>
                  <option value="">ทุกสินค้า</option>
                  {products.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {productShortName(products, p.product_id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                ประเภท
                <select value={filters.demo} onChange={(e) => update('demo', e.target.value as Filters['demo'])}>
                  <option value="">ทั้งหมด (จริงและ DEMO)</option>
                  <option value="false">เฉพาะผลตรวจจริง</option>
                  <option value="true">เฉพาะโหมด DEMO</option>
                </select>
              </label>
              {csvUrl ? (
                <a className="btn btn-primary" href={csvUrl} download>
                  <Download size={16} aria-hidden="true" /> ส่งออก CSV
                </a>
              ) : (
                <button className="btn" disabled title={source === 'demo' ? 'CSV ต้องมาจาก Backend จริง ใช้ไม่ได้ในโหมด DEMO' : 'ยังไม่ได้ตั้ง VITE_API_BASE_URL จึงยังไม่มี Backend ให้ส่งออก'}>
                  <Download size={16} aria-hidden="true" /> ส่งออก CSV
                </button>
              )}
            </div>
            {dateInvalid && (
              <p className="hint" role="alert" style={{ marginTop: 8 }}>
                วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด
              </p>
            )}
          </section>

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
            <div>
              <div className="table-wrap" aria-busy={loading}>
                <table>
                  <caption className="visually-hidden">รายการตรวจ เรียงจากใหม่ไปเก่า</caption>
                  <thead>
                    <tr>
                      <th scope="col">เวลา (ไทย)</th>
                      <th scope="col">โหมด</th>
                      <th scope="col">สินค้าที่คาด</th>
                      <th scope="col">ผล</th>
                      <th scope="col">เหตุผล</th>
                      <th scope="col" className="num">ความคล้าย</th>
                      <th scope="col">บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.items.map((r) => (
                      <tr key={r.inspection_id} aria-selected={r.inspection_id === selectedId} onClick={() => setSelectedId(r.inspection_id)}>
                        <td>
                          <button className="rowbtn" onClick={() => setSelectedId(r.inspection_id)} aria-label={`ดูรายละเอียด ${formatThaiDateTime(r.created_at)}`}>
                            {formatThaiDateTime(r.created_at)}
                          </button>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            {MODE_LABEL[r.source_mode]}
                            {(r.demo || r.is_demo) && <DemoTag />}
                          </span>
                        </td>
                        <td>{productShortName(products, r.expected_product)}</td>
                        <td>
                          <ResultBadge result={r.result} />
                        </td>
                        <td>{REASON_LABEL[r.reason] ?? r.reason}</td>
                        <td className="num">{formatSimilarity(r.match_score)}</td>
                        <td>
                          <span className={`storage ${r.storage_status}`}>{STORAGE_LABEL[r.storage_status]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && data && data.items.length === 0 && (
                  <div className="empty-state">
                    <Inbox size={30} aria-hidden="true" />
                    <span>ยังไม่มีรายการที่ตรงตัวกรอง ลองล้างตัวกรอง หรือเริ่มตรวจจากหน้า Simulation / Webcam</span>
                    <button className="btn btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
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
                  <button className="btn btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
                    <ChevronLeft size={15} aria-hidden="true" /> ก่อนหน้า
                  </button>
                  <button className="btn btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>
                    ถัดไป <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="panel" aria-label="รายละเอียดการตรวจ">
          {selected ? <Detail key={selected.inspection_id} r={selected} onUpdate={replace} /> : <p className="hint">เลือกรายการเพื่อดูภาพและรายละเอียด</p>}
        </aside>
      </div>
    </>
  )
}

function Stat({ cls, icon, label, value }: { cls: string; icon: React.ReactNode; label: string; value: number | null }) {
  return (
    <div className={`stat ${cls}`}>
      <span className="icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="k">{label}</div>
        <div className="v">{value ?? '—'}</div>
      </div>
    </div>
  )
}

function Detail({ r, onUpdate }: { r: InspectionResult; onUpdate(r: InspectionResult): void }) {
  const { ds } = useAppData()
  const [tab, setTab] = useState<'overlay' | 'annotated'>('overlay')
  const original = ds.imageUrl(r, 'original')
  const annotated = ds.imageUrl(r, 'annotated')

  return (
    <div className="stack-sm">
      <div className="row-between">
        <h2>การตรวจ {shortId(r.inspection_id)}</h2>
        <ResultBadge result={r.result} />
      </div>
      <p className="hint">{formatThaiDateTime(r.created_at)}</p>

      <div className="tabs" role="tablist" aria-label="รูปแบบภาพ">
        <button role="tab" aria-selected={tab === 'overlay'} onClick={() => setTab('overlay')}>
          ต้นฉบับ + กรอบ
        </button>
        <button role="tab" aria-selected={tab === 'annotated'} onClick={() => setTab('annotated')}>
          ภาพ annotated
        </button>
      </div>
      <InspectionOverlay
        className="ar-detail"
        src={tab === 'overlay' ? original : annotated}
        result={tab === 'overlay' ? r : null}
        imageWidth={r.image_width}
        imageHeight={r.image_height}
        alt={tab === 'overlay' ? 'ภาพต้นฉบับพร้อมกรอบ' : 'ภาพ annotated จาก Backend'}
        empty={<span>ภาพยังไม่ถูกบันทึก ({STORAGE_LABEL[r.storage_status]})</span>}
      />

      {r.evidence.supporting_images.length > 0 && (
        <div className="stack-sm">
          <h3>หลักฐานมุมอื่น</h3>
          <div className="supporting">
            {r.evidence.supporting_images.map((_, i) => {
              const url = ds.imageUrl(r, { supporting: i })
              const angle = r.evidence.supporting_angles_deg[i]
              return (
                <figure key={i}>
                  {url ? <img src={url} alt={`ภาพหลักฐานมุม ${angle ?? 'ไม่ทราบ'}`} /> : <div className="missing">ยังไม่บันทึก</div>}
                  <figcaption>{angle === null || angle === undefined ? 'ไม่ทราบมุม' : `${angle}°`}</figcaption>
                </figure>
              )
            })}
          </div>
          <p className="hint">
            ค้นหามุม: {r.evidence.search_status}, ครอบคลุมที่รายงาน {r.evidence.reported_coverage_deg ?? '—'}°{' '}
            {r.evidence.verified_coverage ? '(ยืนยันแล้ว)' : '(ยังไม่ยืนยัน)'}
          </p>
        </div>
      )}

      <ResultDetails result={r} onResultUpdate={onUpdate} />
      <ReviewBox r={r} onUpdate={onUpdate} />
    </div>
  )
}

function ReviewBox({ r, onUpdate }: { r: InspectionResult; onUpdate(r: InspectionResult): void }) {
  const { ds } = useAppData()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<InspectionResultValue>(r.result)
  const [reason, setReason] = useState<InspectionReason>(r.reason)
  const [reviewer, setReviewer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (r.reviewed_result) {
    return (
      <div className="notice info">
        <UserCheck size={16} aria-hidden="true" />
        <span>
          ตรวจทานแล้วโดย {r.reviewer}: {r.reviewed_result} ({r.reviewed_reason ? REASON_LABEL[r.reviewed_reason] : '—'}) ผลของระบบเดิมยังเก็บไว้
        </span>
      </div>
    )
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      onUpdate(await ds.review(r.inspection_id, { reviewed_result: result, reviewed_reason: reason, reviewer: reviewer.trim() }))
      setOpen(false)
    } catch (e) {
      setErr(describeApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`notice ${r.result === 'REVIEW' ? 'review' : ''}`} style={{ display: 'grid' }}>
      <div className="row-between">
        <span className="row">
          <Clock3 size={16} aria-hidden="true" /> {r.result === 'REVIEW' ? 'รอคนตรวจทาน' : 'ยังไม่มีคนตรวจทาน'}
        </span>
        {!open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            ตรวจทาน
          </button>
        )}
      </div>
      {open && (
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              ผลที่คนตรวจ
              <select
                value={result}
                onChange={(e) => {
                  const v = e.target.value as InspectionResultValue
                  setResult(v)
                  setReason(REASONS[v][0])
                }}
              >
                <option value="PASS">PASS</option>
                <option value="FAIL">FAIL</option>
                <option value="REVIEW">REVIEW</option>
              </select>
            </label>
            <label className="field" style={{ flex: 2 }}>
              เหตุผล
              <select value={reason} onChange={(e) => setReason(e.target.value as InspectionReason)}>
                {REASONS[result].map((x) => (
                  <option key={x} value={x}>
                    {REASON_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            ชื่อผู้ตรวจทาน
            <input type="text" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !reviewer.trim()}>
              บันทึกการตรวจทาน
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
          </div>
          {err && <p className="hint" role="alert">{err}</p>}
        </div>
      )}
    </div>
  )
}
