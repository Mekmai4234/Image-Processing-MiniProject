import {
  BarChart3,
  Box,
  Camera,
  CheckCircle2,
  Compass,
  ImagePlus,
  Milk,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  Rows3,
  Settings2,
  Split,
  Trash2,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { InspectionOverlay } from '../components/InspectionOverlay'
import { Panel } from '../components/Panel'
import { StatCard } from '../components/StatCard'
import { useDefaultProduct } from '../components/ProductSelect'
import { StorageLine } from '../components/ResultCard'
import { DemoTag, ResultBadge } from '../components/ResultBadge'
import { DEMO_EXAMPLES } from '../demo/demoDataSource'
import { syntheticImage } from '../demo/synthetic'
import {
  createDataSourcePort,
  machineConfigFrom,
  MODEL_NOTICE,
  parseSimulationDefaults,
  RESET_NOTICE,
  ROUTE_LABEL,
  SEARCH_STATUS_LABEL,
  SHAPE_FALLBACK_NOTICE,
  SimulationScene,
  SINGLE_VIEW_NOTICE,
  STATE_LABEL,
  suggestedAngles,
  toJobInput,
  type CompletedEvent,
  type SimulationSceneHandle,
  type SimulationSnapshot,
} from '../features/simulation'
import { useAppData } from '../lib/AppData'
import { resolveApiUrl } from '../lib/api'
import { formatMs, formatSimilarity, REASON_LABEL } from '../lib/format'
import { newRequestId } from '../lib/ids'
import { addCompleted, EMPTY_STATS, percentOf, pipelineStage, PIPELINE_STAGES, simErrorText } from '../lib/simSession'
import { dataUrlToBlob, useObjectUrls } from '../lib/useObjectUrls'
import { appendViews, removeView as dropView, setViewAngle, type ViewItem } from '../lib/views'
import type { InspectionResult } from '../types/inspection'
import type { BottleShapeInput } from '../features/simulation/shape/bottleShape'
import './SimulationPage.css'

const MAX_VIEWS = 12 // MAX_INSPECTION_VIEWS (backend ตรวจซ้ำเสมอ)
const MAX_FILE_MB = 10 // MAX_UPLOAD_MB; 1 MB = 1,000,000 bytes
const FALLBACK_DEFAULTS = { max_rotation_deg: 360, rotation_step_deg: 30 }
const SPEEDS = { min: 0.25, max: 3, step: 0.25 }

const STAGE_ICONS = [Rows3, RefreshCw, Camera, Split, PackageCheck]

interface View extends ViewItem {
  url: string
}

/** state ที่ฉากกำลังทำงาน (รวมตอน pause) — ห้ามแก้ชุดภาพ/สินค้าระหว่างนี้ */
function isRunning(snap: SimulationSnapshot | null): boolean {
  return !!snap && !['IDLE', 'COMPLETE', 'ERROR'].includes(snap.state)
}

export function SimulationPage() {
  const { ds, source, catalog, products } = useAppData()
  const urls = useObjectUrls()
  const sceneRef = useRef<SimulationSceneHandle>(null)

  // ---- ฉาก 02: port/config ต้อง memo ไม่งั้นฉากจะ reset ทุก render ----
  const port = useMemo(() => createDataSourcePort(ds), [ds])
  const defaults = parseSimulationDefaults(catalog)
  const maxDeg = defaults?.max_rotation_deg ?? null
  const stepDeg = defaults?.rotation_step_deg ?? null
  // memo จากตัวเลข ไม่ใช่ object catalog: ตรวจการเชื่อมต่อใหม่แล้วค่าเท่าเดิม ฉากจะไม่ reset กลางงาน
  const config = useMemo(
    () => machineConfigFrom(maxDeg !== null && stepDeg !== null ? { max_rotation_deg: maxDeg, rotation_step_deg: stepDeg } : undefined),
    [maxDeg, stepDeg],
  )
  const angleOptions = useMemo(
    () => suggestedAngles(maxDeg !== null && stepDeg !== null ? { max_rotation_deg: maxDeg, rotation_step_deg: stepDeg } : FALLBACK_DEFAULTS),
    [maxDeg, stepDeg],
  )

  const [snap, setSnap] = useState<SimulationSnapshot | null>(null)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [speed, setSpeed] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  // ผลหลัง "บันทึกซ้ำ" (retry-save) แทนที่ผลในฉากเฉพาะ inspection เดียวกัน
  const [savedResult, setSavedResult] = useState<InspectionResult | null>(null)

  // ---- ข้อมูลที่ผู้ใช้ตั้ง ----
  const [product, setProduct] = useState('')
  useDefaultProduct(product, setProduct)
  const [views, setViews] = useState<View[]>([])
  const [bottleShape, setBottleShape] = useState<BottleShapeInput | null>(null)
  const [shapeBusy, setShapeBusy] = useState(false)
  useEffect(() => {
    setBottleShape(null)
    if (!views[0] || !ds.bottleShape) { setShapeBusy(false); return }
    const ctrl = new AbortController()
    setShapeBusy(true)
    ds.bottleShape(views[0].blob, ctrl.signal).then(result=>{if(!ctrl.signal.aborted)setBottleShape(result)})
      .catch(()=>{if(!ctrl.signal.aborted)setBottleShape(null)})
      .finally(()=>{if(!ctrl.signal.aborted)setShapeBusy(false)})
    return ()=>ctrl.abort()
  }, [ds, views[0]?.blob])
  const [sameBottle, setSameBottle] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // เปลี่ยนแหล่งข้อมูล = ฉากเริ่มใหม่ (port ใหม่) และนับสถิติใหม่
  useEffect(() => {
    setStats(EMPTY_STATS)
    setSnap(null)
    setNotice(null)
    setSavedResult(null)
  }, [ds])

  const onCompleted = useCallback((e: CompletedEvent) => setStats((s) => addCompleted(s, e.result)), [])

  const running = isRunning(snap)
  const paused = !!snap?.paused
  const multi = views.length > 1
  const canStart = !running && snap?.state !== 'ERROR' && !!product && views.length > 0 && (!multi || sameBottle)

  const result =
    snap?.result && savedResult?.inspection_id === snap.result.inspection_id ? savedResult : (snap?.result ?? null)
  const stage = pipelineStage(snap)

  // ภาพจริงที่ส่งตรวจ (Blob เดียวกับที่ฉากส่ง POST /api/inspections)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const captured = snap?.captured_image ?? null
  useEffect(() => {
    if (!captured) {
      setCapturedUrl(null)
      return
    }
    const u = URL.createObjectURL(captured)
    setCapturedUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [captured])

  // DEMO คืนพิกัดจาก examples/ ที่ไม่ได้คำนวณจากภาพนี้ จึงแสดงภาพสังเคราะห์ที่ตรงพิกัดแทน
  const demoResult = !!result && (result.demo || result.is_demo || source === 'demo')
  const shownSrc = result && demoResult ? ds.imageUrl(result, 'original') : capturedUrl

  // ---- ชุดภาพ ----
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
    // ภาพใหม่ angle=null จนผู้ใช้เลือกเอง; ภาพเดิมคงมุมเดิม
    const { views: merged, dropped } = appendViews(views, next, MAX_VIEWS)
    if (dropped > 0) {
      next.slice(next.length - dropped).forEach((x) => urls.revoke(x.url))
      setUploadError(`ส่งได้สูงสุด ${MAX_VIEWS} ภาพต่อรอบ`)
    }
    setViews(merged)
    setIssues([])
  }

  async function loadDemoSet() {
    const base = DEMO_EXAMPLES[0]
    const made = await Promise.all(
      [0, 90, 180, 270].map(async (a) => {
        const blob = await dataUrlToBlob(a === 0 ? syntheticImage(base) : syntheticImage(base, { angle: a }))
        return { id: newRequestId(), blob, name: `demo-${a}.svg`, url: urls.create(blob), angle: a }
      }),
    )
    views.forEach((v) => urls.revoke(v.url))
    setViews(made)
    setSameBottle(true)
    setIssues([])
  }

  function removeView(id: string) {
    const target = views.find((x) => x.id === id)
    if (target) urls.revoke(target.url)
    setViews(dropView(views, id))
    setIssues([])
  }

  function clearViews() {
    views.forEach((v) => urls.revoke(v.url))
    setViews([])
    setSameBottle(false)
    setUploadError(null)
    setIssues([])
  }

  // ---- ปุ่มควบคุมฉาก ----
  function run() {
    setNotice(null)
    const found = sceneRef.current?.start(toJobInput(product, views)) ?? []
    setIssues(found.map((i) => i.message))
  }

  function reset() {
    if (running) setNotice(RESET_NOTICE)
    sceneRef.current?.reset()
    setIssues([])
  }

  function changeSpeed(v: number) {
    setSpeed(v)
    sceneRef.current?.setSpeed(v)
  }

  const orient = snap?.orient ?? null
  const error = snap?.state === 'ERROR' ? snap.error : null
  const productLabel = (id: string) => products.find((p) => p.product_id === id)?.display_name ?? id

  return (
    <>
      <h1 className="visually-hidden">สายพานจำลอง (Simulation)</h1>

      <div className="split">
        <div className="stack">
          <Panel
            className="sim-scene-panel"
            title="3D Simulation Line"
            subtitle="สายการผลิตจำลองสำหรับตรวจฉลากขวด ผลจริงจาก Backend เป็นตัวกำหนดทางคัดแยก"
            icon={<Box size={22} />}
            actions={
              <>
                <span className={`sim-state ${snap ? `is-${snap.state.toLowerCase()}` : 'is-idle'}`} aria-live="polite">
                  {STATE_LABEL[snap?.state ?? 'IDLE']}
                </span>
                {(snap?.demo || source === 'demo') && <DemoTag />}
              </>
            }
          >
            <div className="sim-stage">
              <SimulationScene
                ref={sceneRef}
                port={port}
                config={config}
                onSnapshot={setSnap}
                onCompleted={onCompleted}
                showOverlay={false}
                bottleShape={bottleShape}
              />
            </div>

            {snap?.mode === 'single_view' && (
              <p className="notice review">
                <TriangleAlert size={16} aria-hidden="true" />
                {SINGLE_VIEW_NOTICE}
              </p>
            )}
            {error && (
              <div className="notice error" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <div className="stack-sm">
                  <strong>ระบบขัดข้อง (ERROR) — ไม่ใช่ผลสินค้า</strong>
                  <span>{simErrorText(error)}</span>
                  {error.request_id && <span className="hint">request_id: {error.request_id}</span>}
                </div>
              </div>
            )}
            {notice && (
              <p className="notice info" role="status">
                {notice}
              </p>
            )}
            <p className="hint">
              {shapeBusy ? 'กำลังวิเคราะห์รูปทรงขวด…' : bottleShape?.status === 'ready' ? 'รูปทรงประมาณจากภาพขวดที่อัปโหลด' : SHAPE_FALLBACK_NOTICE} · {MODEL_NOTICE}
            </p>
          </Panel>

          <div className="sim-bottom">
            <Panel title="Inspection pipeline" subtitle="ขั้นตอนตั้งแต่ขวดเข้าเครื่องจนถึงปลายทาง" icon={<Workflow size={22} />}>
              <ol className="sim-pipeline" aria-label="ขั้นตอนบนสายพาน">
                {PIPELINE_STAGES.map((s, i) => {
                  const Icon = STAGE_ICONS[i]
                  const state =
                    i === stage.index ? (stage.error ? 'is-error' : 'is-active') : i < stage.index ? 'is-done' : ''
                  return (
                    <li key={s.key} className={state} aria-current={i === stage.index ? 'step' : undefined}>
                      <span className="sim-n">{i + 1}</span>
                      <Icon size={26} aria-hidden="true" />
                      <strong>{s.label}</strong>
                      <span>{s.detail}</span>
                    </li>
                  )
                })}
              </ol>
            </Panel>

            <Panel title="Live statistics" subtitle="นับเมื่อขวดถึงปลายทาง เฉพาะรอบนี้ในหน้านี้" icon={<BarChart3 size={22} />}>
              <div className="stats sim-stats" data-compact>
                <StatCard tone="total" label="ตรวจแล้ว" value={stats.total} />
                <StatCard tone="pass" label="ผ่าน" value={stats.pass} hint={percentOf(stats.pass, stats.total)} />
                <StatCard tone="fail" label="คัดออก" value={stats.fail} hint={percentOf(stats.fail, stats.total)} />
                <StatCard tone="review" label="ถ่ายใหม่" value={stats.review} hint={percentOf(stats.review, stats.total)} />
              </div>
            </Panel>
          </div>
        </div>

        <div className="stack">
          <Panel
            className="sim-control-panel"
            title="Simulation controls"
            subtitle="อัปโหลดภาพขวดหลายมุม เลือกสินค้า แล้วเริ่มจำลอง"
            icon={<Settings2 size={22} />}
            actions={source === 'demo' ? <DemoTag /> : undefined}
          >
            <div className="stack">
              <section className="sim-step" aria-labelledby="sim-step-1">
                <div className="row-between">
                  <h3 id="sim-step-1">
                    <span className="sim-n">1</span> ภาพขวด ({views.length}/{MAX_VIEWS})
                  </h3>
                  <div className="row">
                    {source === 'demo' && (
                      <button className="btn btn-sm" onClick={loadDemoSet} disabled={running}>
                        ใช้ชุดภาพตัวอย่าง
                      </button>
                    )}
                    {views.length > 0 && (
                      <button className="btn btn-sm" onClick={clearViews} disabled={running}>
                        <Trash2 size={13} aria-hidden="true" /> ล้าง
                      </button>
                    )}
                  </div>
                </div>

                {views.length > 0 && (
                  <div className="thumbs">
                    {views.map((v, i) => {
                      const scanning = orient?.current_view_index === i && snap?.phase === 'ORIENT'
                      const chosen = snap?.primary_view_index === i && !!snap.captured_image
                      return (
                        <div key={v.id} className={`thumb ${chosen ? 'primary' : ''} ${scanning ? 'sim-scanning' : ''}`}>
                          <img src={v.url} alt={`ภาพขวด ${v.name}`} />
                          <div className="meta">
                            <select
                              aria-label={`มุมของ ${v.name}`}
                              value={v.angle ?? ''}
                              onChange={(e) => {
                                setViews((all) => setViewAngle(all, v.id, e.target.value === '' ? null : Number(e.target.value)))
                                setIssues([])
                              }}
                              disabled={running}
                            >
                              <option value="">ไม่ทราบมุม</option>
                              {angleOptions.map((a) => (
                                <option key={a} value={a}>
                                  {a}°
                                </option>
                              ))}
                            </select>
                            {chosen && <span className="sim-chip">ภาพที่ส่งตรวจ</span>}
                          </div>
                          <button className="btn btn-sm remove" aria-label={`ลบ ${v.name}`} onClick={() => removeView(v.id)} disabled={running}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <label className={`drop ${views.length ? 'sim-drop-compact' : ''}`}>
                  <ImagePlus size={24} aria-hidden="true" />
                  <span>เลือกภาพขวด (หลายภาพได้)</span>
                  <span className="hint">
                    JPG/PNG ไม่เกิน {MAX_FILE_MB} MB ต่อภาพ · ภาพเดียวไม่ต้องระบุมุม · หลายภาพต้องระบุมุมทุกภาพ
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={running}
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
                    <input type="checkbox" checked={sameBottle} onChange={(e) => setSameBottle(e.target.checked)} disabled={running} />
                    ทุกภาพเป็นขวดใบเดียวกัน (ต้องยืนยันก่อนส่งหลายมุม)
                  </label>
                )}
              </section>

              <div className="sim-step-grid">
                <section className="sim-step" aria-labelledby="sim-step-2">
                  <h3 id="sim-step-2">
                    <span className="sim-n">2</span> เลือกสินค้า
                  </h3>
                  {products.length === 0 ? (
                    <p className="hint">ยังไม่มีรายการสินค้าจาก catalog</p>
                  ) : (
                    <div className="sim-products" role="radiogroup" aria-labelledby="sim-step-2">
                      {products.map((p) => (
                        <label key={p.product_id} className="sim-product">
                          <input
                            type="radio"
                            name="sim-product"
                            value={p.product_id}
                            checked={product === p.product_id}
                            onChange={() => setProduct(p.product_id)}
                            disabled={running}
                          />
                          {p.reference_paths?.[0] ? <img className="sim-product-photo" src={resolveApiUrl(p.reference_paths[0]) ?? ''} alt={p.display_name}/> : <Milk size={26} aria-hidden="true" />}
                          <span>{p.display_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>

                <section className="sim-step" aria-labelledby="sim-step-3">
                  <h3 id="sim-step-3">
                    <span className="sim-n">3</span> สถานะการหมุนหาฉลาก
                  </h3>
                  <OrientStatus snap={snap} />
                </section>
              </div>

              <section className="sim-step" aria-labelledby="sim-step-4">
                <h3 id="sim-step-4">
                  <span className="sim-n">4</span> ควบคุมการจำลอง
                </h3>
                <div className="sim-controls">
                  <button className="btn btn-run" onClick={run} disabled={!canStart} title="เริ่มตรวจขวดใบใหม่ด้วยชุดภาพนี้">
                    <Play size={17} aria-hidden="true" /> Run
                  </button>
                  <button
                    className="btn"
                    onClick={() => (paused ? sceneRef.current?.resume() : sceneRef.current?.pause())}
                    disabled={!running}
                    aria-pressed={paused}
                  >
                    {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />} {paused ? 'ทำต่อ' : 'Pause'}
                  </button>
                  <button className="btn" onClick={reset} disabled={!snap || snap.state === 'IDLE'}>
                    <RotateCcw size={16} aria-hidden="true" /> Reset
                  </button>
                </div>
                {(error?.retryable || snap?.state === 'COMPLETE') && (
                  <div className="row">
                    {error?.retryable && (
                      <button className="btn btn-primary" onClick={() => sceneRef.current?.retry()}>
                        <RotateCcw size={16} aria-hidden="true" /> ลองส่งคำขอเดิมอีกครั้ง
                      </button>
                    )}
                    {snap?.state === 'COMPLETE' && (
                      <button className="btn" onClick={() => sceneRef.current?.replay()}>
                        <Repeat size={16} aria-hidden="true" /> เล่นซ้ำ (ไม่ตรวจซ้ำ ไม่นับสถิติ)
                      </button>
                    )}
                  </div>
                )}
                {error && !error.retryable && <p className="hint">คำขอนี้ส่งซ้ำไม่ได้ กด Reset แล้วเริ่มรอบใหม่</p>}
                <label className="sim-speed">
                  <span>Speed</span>
                  <input
                    type="range"
                    min={SPEEDS.min}
                    max={SPEEDS.max}
                    step={SPEEDS.step}
                    value={speed}
                    onChange={(e) => changeSpeed(Number(e.target.value))}
                    aria-valuetext={`${speed.toFixed(2)} เท่า`}
                  />
                  <output>{speed.toFixed(2).replace(/0$/, '')}x</output>
                </label>
                <p className="hint">ความเร็วเปลี่ยนเฉพาะภาพเคลื่อนไหว ไม่ย่นเวลารอ Backend</p>
                {!product && <p className="hint">เลือกสินค้าก่อนเริ่ม</p>}
                {multi && !sameBottle && <p className="hint">ยืนยันว่าทุกภาพเป็นขวดใบเดียวกันก่อนเริ่ม</p>}
                {issues.length > 0 && (
                  <ul className="sim-issues" role="alert">
                    {issues.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </Panel>

          <Panel title="Captured inspection image" subtitle="ภาพจริงที่ส่งให้ Backend ตรวจ" icon={<Camera size={22} />}>
            <div className="sim-captured">
              <InspectionOverlay
                className="ar-tall"
                src={shownSrc}
                result={result}
                scanning={snap?.state === 'WAIT_RESULT' || snap?.state === 'INSPECT'}
                alt="ภาพขวดที่ส่งตรวจ"
                compact
                empty={
                  <div>
                    <Camera size={26} aria-hidden="true" />
                    <span className="hint">ยังไม่มีภาพที่ส่งตรวจ</span>
                  </div>
                }
              />
              <div className="stack-sm">
                {result ? (
                  <>
                    <div className={`sim-verdict ${result.result}`}>
                      <ResultBadge result={result.result} size="lg" />
                      <span>MATCH {formatSimilarity(result.match_score)}</span>
                    </div>
                    <dl className="facts">
                      <dt>ผลตรวจ</dt>
                      <dd>{REASON_LABEL[result.reason] ?? result.reason}</dd>
                      <dt>สินค้า</dt>
                      <dd>
                        {productLabel(result.expected_product)}
                        {result.detected_product && result.detected_product !== result.expected_product && (
                          <> → {productLabel(result.detected_product)}</>
                        )}
                      </dd>
                      <dt>พื้นที่ฉลาก</dt>
                      <dd>{result.bbox ? `${result.bbox.width} × ${result.bbox.height} px` : '—'}</dd>
                      <dt>เวลาตรวจ</dt>
                      <dd>{formatMs(result.timing_ms.inspection)}</dd>
                      {snap?.route && (
                        <>
                          <dt>ปลายทาง</dt>
                          <dd>{ROUTE_LABEL[snap.route]}</dd>
                        </>
                      )}
                    </dl>
                    <StorageLine result={result} onResultUpdate={setSavedResult} />
                    <Link className="hint" to="/history">
                      ดูรายการนี้ในหน้า History
                    </Link>
                  </>
                ) : (
                  <p className="hint">
                    {snap?.state === 'WAIT_RESULT' ? 'ส่งภาพแล้ว กำลังรอผลจาก Backend…' : 'ผลจะแสดงเมื่อ Backend ตอบกลับเท่านั้น'}
                  </p>
                )}
              </div>
            </div>
            {result && demoResult && <p className="hint">DEMO แสดงภาพสังเคราะห์ที่ตรงพิกัดตัวอย่าง ไม่ได้ตรวจภาพที่คุณเลือก</p>}
          </Panel>
        </div>
      </div>
    </>
  )
}

function OrientStatus({ snap }: { snap: SimulationSnapshot | null }) {
  const orient = snap?.orient ?? null
  if (snap?.mode === 'single_view') {
    return (
      <div className="sim-orient">
        <Compass size={28} aria-hidden="true" />
        <div>
          <strong>ภาพเดียว ไม่หมุนค้นหา</strong>
          <span className="hint">{SEARCH_STATUS_LABEL.not_requested}</span>
        </div>
      </div>
    )
  }
  if (!orient) {
    return (
      <div className="sim-orient">
        <Compass size={28} aria-hidden="true" />
        <div>
          <strong>ยังไม่เริ่ม</strong>
          <span className="hint">หลายภาพ: ฉากจะหมุนตามมุมจริงที่อัปโหลดทีละมุม</span>
        </div>
      </div>
    )
  }
  const found = orient.search_status === 'usable_view_found'
  const angle = snap?.captured_angle_deg ?? snap?.current_angle_deg ?? null
  return (
    <div className={`sim-orient ${found ? 'is-found' : ''}`}>
      {found ? <CheckCircle2 size={28} aria-hidden="true" /> : <Compass size={28} aria-hidden="true" />}
      <div>
        <strong>
          {orient.search_status ? SEARCH_STATUS_LABEL[orient.search_status] : 'กำลังค้นหา…'}
          {found && angle !== null ? ` ที่ ${angle}°` : ''}
        </strong>
        <span className="hint">
          ค้นแล้ว {orient.tried_angles.length}/{orient.total} มุม
          {!found && angle !== null ? ` · มุมปัจจุบัน ${angle}°` : ''}
        </span>
      </div>
    </div>
  )
}
