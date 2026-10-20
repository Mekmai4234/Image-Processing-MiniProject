import { Camera, CircleDashed, CircleCheck, CircleAlert, FileImage, ScanSearch, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { InspectionOverlay } from '../components/InspectionOverlay'
import { ProductSelect, useDefaultProduct } from '../components/ProductSelect'
import { ResultCard } from '../components/ResultCard'
import { DemoTag, ResultBadge } from '../components/ResultBadge'
import { DEMO_EXAMPLES } from '../demo/demoDataSource'
import { syntheticImage } from '../demo/synthetic'
import { CameraPanel } from '../features/webcam'
import { describeApiError, isAbort } from '../lib/api'
import { useAppData } from '../lib/AppData'
import { formatMs, formatSimilarity, LOCATOR_LABEL, productShortName } from '../lib/format'
import { newRequestId } from '../lib/ids'
import { useInspectionRun } from '../lib/useInspectionRun'
import { dataUrlToBlob, useObjectUrls } from '../lib/useObjectUrls'
import type { InspectionResult, LocateLabelResult } from '../types/inspection'

const GUIDE = ['วางขวดในกรอบ', 'หมุนขวดช้า ๆ', 'ถือนิ่ง', 'ถ่ายและตรวจ']

type Check = boolean | null

function CheckItem({ ok, children }: { ok: Check; children: string }) {
  const Icon = ok === null ? CircleDashed : ok ? CircleCheck : CircleAlert
  return (
    <li className={ok === null ? 'unknown' : ok ? 'ok' : 'no'}>
      <Icon size={18} aria-hidden="true" />
      {children}
      <span className="visually-hidden">{ok === null ? 'ยังไม่ทราบ' : ok ? 'ผ่าน' : 'ยังไม่ผ่าน'}</span>
    </li>
  )
}

export function WebcamPage() {
  const { ds, source, products } = useAppData()
  const run = useInspectionRun(ds)
  const urls = useObjectUrls()
  const [product, setProduct] = useState('')
  useDefaultProduct(product, setProduct)

  // Mode: live webcam stream (04) vs manual file upload test (01)
  const [inputMode, setInputMode] = useState<'webcam' | 'file'>('webcam')

  const [frame, setFrame] = useState<{ blob: Blob; url: string; name: string } | null>(null)
  const [locator, setLocator] = useState<LocateLabelResult | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [captures, setCaptures] = useState<InspectionResult[]>([])
  const locCtrl = useRef<AbortController | null>(null)

  useEffect(() => () => locCtrl.current?.abort(), [])
  useEffect(() => setCaptures([]), [ds])

  useEffect(() => {
    if (run.state.phase !== 'result') return
    const r = run.state.result
    setCaptures((c) => [r, ...c.filter((x) => x.inspection_id !== r.inspection_id)].slice(0, 6))
  }, [run.state])

  function handleInspectionComplete(r: InspectionResult) {
    setCaptures((c) => [r, ...c.filter((x) => x.inspection_id !== r.inspection_id)].slice(0, 6))
  }

  function newFrame(blob: Blob, name: string) {
    locCtrl.current?.abort()
    if (frame) urls.revoke(frame.url)
    setFrame({ blob, url: urls.create(blob), name })
    setLocator(null)
    setLocError(null)
    run.reset()
  }

  async function loadDemoFrame() {
    newFrame(await dataUrlToBlob(syntheticImage(DEMO_EXAMPLES[0])), 'demo-frame.svg')
  }

  async function locate() {
    if (!frame || !product) return
    locCtrl.current?.abort()
    const ctrl = new AbortController()
    locCtrl.current = ctrl
    setLocating(true)
    setLocError(null)
    try {
      const r = await ds.locateLabel(frame.blob, product, ctrl.signal)
      if (!ctrl.signal.aborted) setLocator(r)
    } catch (e) {
      if (!isAbort(e)) setLocError(describeApiError(e))
    } finally {
      if (locCtrl.current === ctrl) setLocating(false)
    }
  }

  function captureAndInspect() {
    if (!frame || !product) return
    void run.run({
      image: frame.blob,
      imageName: frame.name,
      expected_product: product,
      source_mode: 'webcam',
      client_request_id: newRequestId(),
    })
  }

  const busy = run.state.phase === 'checking'
  const result = run.state.phase === 'result' ? run.state.result : null
  const shown = result && source === 'demo' ? ds.imageUrl(result, 'original') : (frame?.url ?? null)
  const step = !frame ? 0 : busy || result ? 3 : locator?.usable_view ? 2 : 1
  const guidance = result
    ? null
    : locError
      ? { tone: 'error', text: locError }
      : locator
        ? { tone: locator.usable_view ? 'info' : 'review', text: LOCATOR_LABEL[locator.reason] }
        : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตรวจด้วยกล้อง</h1>
          <p>หมุนขวดหน้ากล้องจนเห็นฉลาก ถือนิ่ง แล้วถ่ายให้ Backend ตรวจ</p>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button
            className={`btn ${inputMode === 'webcam' ? 'btn-primary' : ''}`}
            onClick={() => setInputMode('webcam')}
          >
            <Video size={16} aria-hidden="true" /> กล้องเว็บแคมสด
          </button>
          <button
            className={`btn ${inputMode === 'file' ? 'btn-primary' : ''}`}
            onClick={() => setInputMode('file')}
          >
            <FileImage size={16} aria-hidden="true" /> ทดสอบด้วยไฟล์ภาพ
          </button>
        </div>
      </div>

      {inputMode === 'webcam' ? (
        <div className="stack" style={{ gap: '1.5rem' }}>
          <CameraPanel
            expectedProduct={product || 'bottle_a'}
            onProductChange={setProduct}
            onInspectionComplete={handleInspectionComplete}
            autoLocate={true}
          />

          {captures.length > 0 && (
            <section className="panel" aria-labelledby="recent-title">
              <div className="panel-head">
                <h2 id="recent-title">ประวัติการตรวจในเซสชันนี้</h2>
                <span className="hint">เฉพาะในหน้านี้</span>
              </div>
              <div className="captures">
                {captures.map((c) => (
                  <div key={c.inspection_id} className="capture" data-tone={c.result}>
                    <InspectionOverlay
                      src={ds.imageUrl(c, 'original')}
                      result={c}
                      alt="ภาพที่ตรวจ"
                      showReadout={false}
                      compact
                      empty={<span className="hint">ไม่มีภาพ</span>}
                    />
                    <div className="info">
                      <ResultBadge result={c.result} />
                      <strong style={{ color: 'var(--text)' }}>
                        {productShortName(products, c.detected_product ?? c.expected_product)}
                      </strong>
                      <span>ความคล้าย {formatSimilarity(c.match_score)}</span>
                      <span>เวลาตรวจ {formatMs(c.timing_ms.inspection)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="split">
          <div className="stack">
            <section className="panel" aria-labelledby="cam-title">
              <div className="panel-head">
                <div>
                  <div className="title">
                    <FileImage size={20} aria-hidden="true" />
                    <h2 id="cam-title">ทดสอบด้วยไฟล์ภาพ</h2>
                  </div>
                  <p className="panel-sub">เลือกภาพขวดจากเครื่องเพื่อทดสอบ locator และการตรวจผ่าน API</p>
                </div>
                {source === 'demo' && <DemoTag />}
              </div>

              <div className="stack-sm">
                <InspectionOverlay
                  className="ar-video"
                  src={shown}
                  result={result}
                  locatorBox={locator?.bbox ?? null}
                  imageWidth={locator?.image_width}
                  imageHeight={locator?.image_height}
                  scanning={busy || locating}
                  alt="ภาพขวดจากกล้องหรือไฟล์"
                  status={
                    frame ? (
                      <>
                        <FileImage size={14} aria-hidden="true" /> {frame.name}
                      </>
                    ) : undefined
                  }
                  empty={
                    <div>
                      <Camera size={34} aria-hidden="true" />
                      <strong>ยังไม่มีภาพ</strong>
                      <span className="hint">เลือกไฟล์ภาพเพื่อทดสอบขั้นตอน</span>
                    </div>
                  }
                />

                {guidance && (
                  <div className={`notice ${guidance.tone}`} role="status">
                    <ScanSearch size={16} aria-hidden="true" />
                    <span>{guidance.text}</span>
                  </div>
                )}

                <ol className="steps" aria-label="ขั้นตอน">
                  {GUIDE.map((g, i) => (
                    <li
                      key={g}
                      className={i === step ? 'active' : i < step ? 'done' : ''}
                      aria-current={i === step ? 'step' : undefined}
                    >
                      <span className="n">{i + 1}</span>
                      {g}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <section className="panel" aria-labelledby="recent-title">
              <div className="panel-head">
                <h2 id="recent-title">ภาพที่ถ่ายล่าสุด</h2>
                <span className="hint">เฉพาะในหน้านี้</span>
              </div>
              {captures.length === 0 ? (
                <div className="empty-state">
                  <Camera size={28} aria-hidden="true" />
                  <span>ยังไม่มีภาพที่ตรวจ กด "ถ่ายและตรวจ" เพื่อเริ่ม</span>
                </div>
              ) : (
                <div className="captures">
                  {captures.map((c) => (
                    <div key={c.inspection_id} className="capture" data-tone={c.result}>
                      <InspectionOverlay
                        src={ds.imageUrl(c, 'original')}
                        result={c}
                        alt="ภาพที่ตรวจ"
                        showReadout={false}
                        compact
                        empty={<span className="hint">ไม่มีภาพ</span>}
                      />
                      <div className="info">
                        <ResultBadge result={c.result} />
                        <strong style={{ color: 'var(--text)' }}>
                          {productShortName(products, c.detected_product ?? c.expected_product)}
                        </strong>
                        <span>ความคล้าย {formatSimilarity(c.match_score)}</span>
                        <span>เวลาตรวจ {formatMs(c.timing_ms.inspection)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="stack">
            <section className="panel" aria-labelledby="ctl-title">
              <div className="panel-head">
                <div className="title">
                  <Camera size={20} aria-hidden="true" />
                  <h2 id="ctl-title">ควบคุมการตรวจ</h2>
                </div>
              </div>
              <div className="stack-sm">
                <ProductSelect
                  value={product}
                  onChange={(v) => {
                    setProduct(v)
                    setLocator(null)
                    run.reset()
                  }}
                  disabled={busy}
                />

                <div className="row">
                  <label className="btn" style={{ flex: 1 }}>
                    <FileImage size={16} aria-hidden="true" /> เลือกไฟล์ภาพ
                    <input
                      type="file"
                      accept="image/*"
                      className="visually-hidden"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) newFrame(f, f.name)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {source === 'demo' && (
                    <button className="btn" onClick={loadDemoFrame} disabled={busy}>
                      ภาพตัวอย่าง
                    </button>
                  )}
                </div>

                <button className="btn" onClick={locate} disabled={!frame || !product || busy || locating}>
                  <ScanSearch size={16} aria-hidden="true" /> {locating ? 'กำลังหาฉลาก…' : 'หาฉลากในภาพ'}
                </button>

                <button
                  className="btn btn-primary btn-lg"
                  onClick={captureAndInspect}
                  disabled={!frame || !product || busy}
                >
                  <Camera size={20} aria-hidden="true" /> {busy ? 'กำลังตรวจ…' : 'ถ่ายและตรวจ'}
                </button>

                <div className="subpanel">
                  <h3 style={{ marginBottom: 10 }}>ความพร้อมของภาพ</h3>
                  <ul className="checklist">
                    <CheckItem ok={locator ? locator.quality.sharp_enough : null}>ภาพคมชัด</CheckItem>
                    <CheckItem ok={locator ? locator.quality.bottle_visible : null}>เห็นทั้งขวด</CheckItem>
                    <CheckItem ok={locator ? locator.quality.label_visible : null}>เห็นฉลาก</CheckItem>
                    <CheckItem ok={result ? result.detected_product === result.expected_product : null}>
                      ตรงสินค้า (รู้หลังตรวจ)
                    </CheckItem>
                  </ul>
                </div>
              </div>
            </section>

            <section className="panel" aria-labelledby="latest-title">
              <div className="panel-head">
                <h2 id="latest-title">ผลล่าสุด</h2>
              </div>
              <ResultCard
                state={run.state}
                onRetry={run.retry}
                onResultUpdate={run.replaceResult}
                idleText="ยังไม่ได้ตรวจ ผลจะขึ้นหลัง Backend ตอบกลับเท่านั้น"
              />
            </section>
          </div>
        </div>
      )}
    </>
  )
}
