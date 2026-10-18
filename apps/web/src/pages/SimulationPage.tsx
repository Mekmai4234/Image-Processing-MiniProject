import { Box, ImagePlus, Layers, Play, RotateCcw, Star, Trash2, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { InspectionOverlay } from '../components/InspectionOverlay'
import { ProductSelect, useDefaultProduct } from '../components/ProductSelect'
import { ResultCard } from '../components/ResultCard'
import { DemoTag, ResultBadge } from '../components/ResultBadge'
import { DEMO_EXAMPLES } from '../demo/demoDataSource'
import { syntheticImage } from '../demo/synthetic'
import { useAppData } from '../lib/AppData'
import { REASON_LABEL } from '../lib/format'
import { newRequestId } from '../lib/ids'
import { useInspectionRun } from '../lib/useInspectionRun'
import { dataUrlToBlob, useObjectUrls } from '../lib/useObjectUrls'
import type { InspectionRequest, InspectionResult } from '../types/inspection'

const MAX_VIEWS = 12 // MAX_INSPECTION_VIEWS (backend ตรวจซ้ำเสมอ)
const MAX_FILE_MB = 10 // MAX_UPLOAD_MB; 1 MB = 1,000,000 bytes

interface View {
  id: string
  blob: Blob
  name: string
  url: string
  angle: number | null
}

const PIPELINE = [
  { key: 'feed', label: 'Feed', detail: 'ขวดเข้าสายพาน' },
  { key: 'orient', label: 'Orient', detail: 'หมุนหามุมฉลาก' },
  { key: 'inspect', label: 'Inspect', detail: 'ส่งภาพให้ Backend ตรวจ' },
  { key: 'sort', label: 'Sort', detail: 'แยกตามผลจริง' },
  { key: 'output', label: 'Output', detail: 'ผ่านไปสายหลัก' },
]

export function SimulationPage() {
  const { ds, source, catalog } = useAppData()
  const run = useInspectionRun(ds)
  const urls = useObjectUrls()
  const [product, setProduct] = useState('')
  useDefaultProduct(product, setProduct)
  const [views, setViews] = useState<View[]>([])
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [sameBottle, setSameBottle] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [session, setSession] = useState<InspectionResult[]>([])

  const step = catalog?.simulation_defaults?.rotation_step_deg ?? 30
  const maxDeg = catalog?.simulation_defaults?.max_rotation_deg ?? 360
  const angleOptions = useMemo(() => {
    const out: number[] = []
    for (let a = 0; a < Math.min(maxDeg, 360); a += step) out.push(a)
    return out
  }, [step, maxDeg])

  // เก็บผลของหน้านี้ไว้แสดงสถิติรอบนี้ (ไม่ใช่สถิติรวมของระบบ)
  useEffect(() => {
    if (run.state.phase !== 'result') return
    const r = run.state.result
    setSession((s) => (s.some((x) => x.inspection_id === r.inspection_id) ? s.map((x) => (x.inspection_id === r.inspection_id ? r : x)) : [r, ...s]))
  }, [run.state])

  // เปลี่ยนแหล่งข้อมูล = เริ่มนับใหม่
  useEffect(() => setSession([]), [ds])

  const primary = views.find((v) => v.id === primaryId) ?? views[0] ?? null
  const multi = views.length > 1
  const busy = run.state.phase === 'checking'
  const canRun = !!primary && !!product && (!multi || sameBottle) && !busy

  function invalidate() {
    run.reset() // ภาพ/สินค้าเปลี่ยน ผลเดิมไม่ใช่ของชุดนี้แล้ว
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    setUploadError(null)
    const next: View[] = []
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        setUploadError(`${f.name} ไม่ใช่ไฟล์ภาพ`)
        continue
      }
      if (f.size > MAX_FILE_MB * 1_000_000) {
        setUploadError(`${f.name} ใหญ่เกิน ${MAX_FILE_MB} MB`)
        continue
      }
      next.push({ id: newRequestId(), blob: f, name: f.name, url: urls.create(f), angle: null })
    }
    setViews((v) => {
      const all = [...v, ...next]
      if (all.length > MAX_VIEWS) setUploadError(`ส่งได้สูงสุด ${MAX_VIEWS} ภาพต่อรอบ`)
      return all.slice(0, MAX_VIEWS).map((x, i) => ({ ...x, angle: x.angle ?? (angleOptions[i] ?? null) }))
    })
    invalidate()
  }

  async function loadDemoSet() {
    const base = DEMO_EXAMPLES[0]
    const angles = [0, 90, 180, 270]
    const made = await Promise.all(
      angles.map(async (a) => {
        const blob = await dataUrlToBlob(a === 0 ? syntheticImage(base) : syntheticImage(base, { angle: a }))
        return { id: newRequestId(), blob, name: `demo-${a}.svg`, url: urls.create(blob), angle: a }
      }),
    )
    setViews(made)
    setPrimaryId(made[0].id)
    setSameBottle(true)
    invalidate()
  }

  function removeView(id: string) {
    setViews((v) => {
      const target = v.find((x) => x.id === id)
      if (target) urls.revoke(target.url)
      return v.filter((x) => x.id !== id)
    })
    if (primaryId === id) setPrimaryId(null)
    invalidate()
  }

  function setAngle(id: string, angle: number | null) {
    setViews((v) => v.map((x) => (x.id === id ? { ...x, angle } : x)))
    invalidate()
  }

  function startInspection() {
    if (!primary) return
    const supporting = views.filter((v) => v.id !== primary.id)
    const req: InspectionRequest = {
      image: primary.blob,
      imageName: primary.name,
      expected_product: product,
      source_mode: 'simulation',
      client_request_id: newRequestId(), // รอบใหม่ = id ใหม่
      ...(primary.angle !== null ? { angle_deg: primary.angle } : {}),
    }
    if (supporting.length > 0) {
      req.supporting_images = supporting.map((v) => ({ blob: v.blob, name: v.name }))
      req.evidence = {
        kind: 'multi_view',
        // ยังไม่มีฉาก ORIENT ของ 02: ส่งชุดภาพตรง ๆ ไม่อ้างว่าค้นหามุมแล้ว
        search_status: 'not_requested',
        supporting_angles_deg: supporting.map((v) => v.angle),
        reported_coverage_deg: null,
      }
    }
    void run.run(req)
  }

  function resetAll() {
    run.reset()
    views.forEach((v) => urls.revoke(v.url))
    setViews([])
    setPrimaryId(null)
    setSameBottle(false)
    setUploadError(null)
  }

  const result = run.state.phase === 'result' ? run.state.result : null
  const shownImage = result ? (source === 'demo' ? ds.imageUrl(result, 'original') : ds.imageUrl(result, 'original') ?? primary?.url ?? null) : (primary?.url ?? null)

  const activeStage = run.state.phase === 'checking' ? 2 : result ? (result.result === 'PASS' ? 4 : 3) : -1
  const passed = session.filter((r) => r.result === 'PASS').length
  const rejected = session.length - passed

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สายพานจำลอง</h1>
          <p>อัปโหลดภาพขวดหลายมุม แล้วส่งให้ Backend ตรวจ ผลจริงเป็นตัวกำหนดทางคัดแยก</p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="scene-title">
            <div className="panel-head">
              <div>
                <div className="title">
                  <Box size={20} aria-hidden="true" />
                  <h2 id="scene-title">ฉากสายพาน 3D</h2>
                </div>
                <p className="panel-sub">ส่วนนี้จะฝังฉาก Three.js ของงาน 02 ตามข้อตกลงใน pages/slots.ts</p>
              </div>
            </div>
            <div className="viewport scene-slot">
              <div className="empty">
                <div>
                  <Workflow size={36} aria-hidden="true" />
                  <strong>รอคอมโพเนนต์ฉากจากงาน 02</strong>
                  <span className="hint">ระหว่างนี้หน้าเว็บส่งชุดภาพตรวจได้เลย ผลจะแสดงด้านล่างและในประวัติ</span>
                  {result && (
                    <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                      <ResultBadge result={result.result} />
                      <span>{result.result === 'PASS' ? 'ส่งเข้าสายหลัก' : `คัดออก: ${REASON_LABEL[result.reason]}`}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="pipeline-overlay">
                <ol className="steps" aria-label="ขั้นตอนบนสายพาน">
                  {PIPELINE.map((p, i) => (
                    <li
                      key={p.key}
                      className={i === activeStage ? 'active' : i < activeStage ? 'done' : ''}
                      aria-current={i === activeStage ? 'step' : undefined}
                      title={p.detail}
                    >
                      <span className="n">{i + 1}</span>
                      {p.label}
                    </li>
                  ))}
                </ol>
              </div>
              <span className="corner tl" />
              <span className="corner tr" />
              <span className="corner bl" />
              <span className="corner br" />
            </div>
          </section>

          <section className="panel" aria-labelledby="capture-title">
            <div className="panel-head">
              <div>
                <h2 id="capture-title">ภาพที่ใช้ตรวจ</h2>
                <p className="panel-sub">{primary ? `ภาพหลัก${primary.angle !== null ? ` มุม ${primary.angle}°` : ''}` : 'ยังไม่ได้เลือกภาพ'}</p>
              </div>
            </div>
            <div className="inspect-grid">
              <div className="stack-sm">
              <InspectionOverlay
                className="ar-tall"
                src={shownImage}
                result={result}
                scanning={busy}
                alt="ภาพขวดที่ส่งตรวจ"
                empty={
                  <div>
                    <ImagePlus size={30} aria-hidden="true" />
                    <span>เลือกภาพขวดเพื่อเริ่มตรวจ</span>
                  </div>
                }
              />
              {result && source === 'demo' && <p className="hint">DEMO แสดงภาพสังเคราะห์ที่ตรงพิกัดตัวอย่าง ไม่ได้ตรวจภาพที่คุณเลือก</p>}
              </div>
              <ResultCard
                state={run.state}
                onRetry={run.retry}
                onResultUpdate={run.replaceResult}
                idleText="ผลตรวจจะแสดงหลัง Backend ตอบกลับเท่านั้น"
              />
            </div>
          </section>

        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="controls-title">
            <div className="panel-head">
              <h2 id="controls-title">ตั้งค่าการตรวจ</h2>
              {source === 'demo' && <DemoTag />}
            </div>

            <div className="stack-sm">
              <ProductSelect
                value={product}
                onChange={(v) => {
                  setProduct(v)
                  invalidate()
                }}
                disabled={busy}
              />

              <div className="row-between">
                <h3>ภาพขวด ({views.length}/{MAX_VIEWS})</h3>
                {source === 'demo' && (
                  <button className="btn btn-sm" onClick={loadDemoSet} disabled={busy}>
                    ใช้ชุดภาพตัวอย่าง
                  </button>
                )}
              </div>

              {views.length > 0 && (
                <div className="thumbs">
                  {views.map((v) => (
                    <div key={v.id} className={`thumb ${primary?.id === v.id ? 'primary' : ''}`}>
                      <img src={v.url} alt={`ภาพขวด ${v.name}`} />
                      <div className="meta">
                        <select
                          aria-label={`มุมของ ${v.name}`}
                          value={v.angle ?? ''}
                          onChange={(e) => setAngle(v.id, e.target.value === '' ? null : Number(e.target.value))}
                          disabled={busy}
                        >
                          <option value="">ไม่ทราบมุม</option>
                          {angleOptions.map((a) => (
                            <option key={a} value={a}>
                              {a}°
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-sm"
                          aria-pressed={primary?.id === v.id}
                          onClick={() => {
                            setPrimaryId(v.id)
                            invalidate()
                          }}
                          disabled={busy}
                        >
                          <Star size={13} aria-hidden="true" /> {primary?.id === v.id ? 'ภาพหลัก' : 'ตั้งเป็นหลัก'}
                        </button>
                      </div>
                      <button className="btn btn-sm remove" aria-label={`ลบ ${v.name}`} onClick={() => removeView(v.id)} disabled={busy}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="drop">
                <ImagePlus size={24} aria-hidden="true" />
                <span>เลือกภาพขวด (หลายภาพได้)</span>
                <span className="hint">JPG/PNG ไม่เกิน {MAX_FILE_MB} MB ต่อภาพ ภาพเดียว = ตรวจมุมเดียว</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              {uploadError && (
                <p className="hint" role="alert">
                  {uploadError}
                </p>
              )}

              {multi && (
                <label className="check">
                  <input type="checkbox" checked={sameBottle} onChange={(e) => setSameBottle(e.target.checked)} disabled={busy} />
                  ทุกภาพเป็นขวดใบเดียวกัน (ต้องยืนยันก่อนส่งหลายมุม)
                </label>
              )}

              <div className="row">
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={startInspection} disabled={!canRun}>
                  <Play size={17} aria-hidden="true" /> {busy ? 'กำลังตรวจ…' : 'ตรวจชุดภาพนี้'}
                </button>
                <button className="btn" onClick={resetAll}>
                  <RotateCcw size={16} aria-hidden="true" /> รีเซ็ต
                </button>
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="session-title">
            <div className="panel-head">
              <div className="title">
                <Layers size={20} aria-hidden="true" />
                <h2 id="session-title">สรุปรอบนี้</h2>
              </div>
              <span className="hint">นับเฉพาะที่ตรวจในหน้านี้ ดูทั้งหมดที่ History</span>
            </div>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }} data-compact>
              <div className="stat total">
                <div>
                  <div className="k">ตรวจแล้ว</div>
                  <div className="v">{session.length}</div>
                </div>
              </div>
              <div className="stat pass">
                <div>
                  <div className="k">ผ่าน</div>
                  <div className="v">{passed}</div>
                </div>
              </div>
              <div className="stat fail">
                <div>
                  <div className="k">คัดออก</div>
                  <div className="v">{rejected}</div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </>
  )
}
