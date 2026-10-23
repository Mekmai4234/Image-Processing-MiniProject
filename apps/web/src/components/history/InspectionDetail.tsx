import { CheckCircle2, Clock3, Download, FileJson, FileImage, HelpCircle, Image as ImageIcon, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { describeApiError } from '../../lib/api'
import { useAppData } from '../../lib/AppData'
import { formatSimilarity, formatThaiDateTime, MODE_LABEL, productShortName, REASON_LABEL, REASON_SHORT, shortId } from '../../lib/format'
import { localFiles, resultFileName, type FileState } from '../../lib/historyFiles'
import type { InspectionResult } from '../../types/inspection'
import { InspectionOverlay } from '../InspectionOverlay'
import { StorageLine } from '../ResultCard'
import { DemoTag, ResultBadge } from '../ResultBadge'
import { ReviewPanel } from './ReviewPanel'

type Tab = 'original' | 'annotated'

/** เปิด/บันทึกไฟล์ผ่าน blob URL ใช้ได้ทั้ง URL ของ backend (CORS) และภาพ DEMO (data:) */
async function openAsBlob(url: string, saveAs?: string) {
  const blob = await (await fetch(url)).blob()
  const href = URL.createObjectURL(blob)
  if (saveAs) {
    const a = document.createElement('a')
    a.href = href
    a.download = saveAs
    a.click()
  } else {
    window.open(href, '_blank', 'noopener')
  }
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

const FILE_STATE: Record<FileState, { icon: typeof CheckCircle2; label: string }> = {
  saved: { icon: CheckCircle2, label: 'บันทึกแล้ว' },
  pending: { icon: Clock3, label: 'กำลังบันทึก' },
  missing: { icon: XCircle, label: 'ยังไม่บันทึก' },
  unknown: { icon: HelpCircle, label: 'Backend ยังไม่รายงาน' },
}

/** แถบรายละเอียดของแถวที่เลือก — ทุกค่ามาจาก inspection_id เดียวกัน */
export function InspectionDetail({ r, onUpdate }: { r: InspectionResult; onUpdate(r: InspectionResult): void }) {
  const { ds, products } = useAppData()
  const [tab, setTab] = useState<Tab>('annotated')
  const [busy, setBusy] = useState<'view' | 'download' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const original = ds.imageUrl(r, 'original')
  const annotated = ds.imageUrl(r, 'annotated')
  // Annotated: ใช้ภาพที่ backend วาด ถ้ายังไม่มีให้วาดกรอบจากผลตรวจบนต้นฉบับแทน และบอกให้ชัด
  const annotatedFallback = tab === 'annotated' && !annotated && !!original
  const shownSrc = tab === 'original' ? original : (annotated ?? original)
  const isDemo = Boolean(r.demo || r.is_demo)

  async function run(kind: 'view' | 'download', job: () => Promise<void>) {
    setBusy(kind)
    setActionError(null)
    try {
      await job()
    } catch (e) {
      setActionError(e instanceof Error && e.name !== 'ApiError' ? 'เปิดไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง' : describeApiError(e))
    } finally {
      setBusy(null)
    }
  }

  const viewOriginal = () => run('view', () => openAsBlob(original!))
  const downloadResult = () =>
    run('download', async () => {
      // ผลล่าสุดจาก API (รวมสถานะบันทึก/ตรวจทาน) ตาม storage guide ไม่อ่าน result.json ตรง
      const fresh = await ds.getInspection(r.inspection_id)
      const blob = new Blob([JSON.stringify(fresh, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = resultFileName(r)
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 60_000)
    })

  return (
    <div className="detail">
      <div className="detail-head">
        <h2>
          Inspection <span className="detail-id">#{shortId(r.inspection_id)}</span>
        </h2>
        <ResultBadge result={r.result} size="lg" detail={REASON_SHORT[r.reason]} />
      </div>
      <p className="hint">
        {REASON_LABEL[r.reason]}
        {isDemo && (
          <>
            {' '}
            <DemoTag />
          </>
        )}
      </p>

      <div className="tabs" role="tablist" aria-label="รูปแบบภาพ">
        <button role="tab" aria-selected={tab === 'original'} onClick={() => setTab('original')}>
          Original
        </button>
        <button role="tab" aria-selected={tab === 'annotated'} onClick={() => setTab('annotated')}>
          Annotated
        </button>
      </div>
      <InspectionOverlay
        className="ar-detail"
        src={shownSrc}
        result={annotatedFallback ? r : null}
        imageWidth={r.image_width}
        imageHeight={r.image_height}
        alt={tab === 'original' ? 'ภาพต้นฉบับที่ใช้ตรวจ' : 'ภาพผลตรวจพร้อมกรอบ'}
        empty={<span>ภาพยังไม่ถูกบันทึกบนเครื่องที่รัน Backend</span>}
      />
      {annotatedFallback && <p className="hint">ภาพ annotated ยังไม่บันทึก แสดงกรอบที่วาดจากผลตรวจบนภาพต้นฉบับแทน</p>}

      <dl className="kv">
        <dt>Expected product</dt>
        <dd>{productShortName(products, r.expected_product)}</dd>
        <dt>Detected product</dt>
        <dd>{productShortName(products, r.detected_product)}</dd>
        <dt>
          Match score <span className="hint">(similarity)</span>
        </dt>
        <dd>{formatSimilarity(r.match_score)}</dd>
        <dt>Mode</dt>
        <dd>{MODE_LABEL[r.source_mode]}</dd>
        <dt>Captured</dt>
        <dd>{formatThaiDateTime(r.created_at)}</dd>
      </dl>

      <div className="detail-actions">
        <button className="btn" onClick={viewOriginal} disabled={!original || busy !== null} title={original ? undefined : 'ภาพต้นฉบับยังไม่ถูกบันทึก'}>
          {busy === 'view' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ImageIcon size={16} aria-hidden="true" />} View original
        </button>
        <button className="btn btn-primary" onClick={downloadResult} disabled={busy !== null}>
          {busy === 'download' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} Download result
        </button>
      </div>
      {actionError && (
        <p className="hint" role="alert">
          {actionError}
        </p>
      )}

      <section className="files" aria-labelledby={`files-${r.inspection_id}`}>
        <h3 id={`files-${r.inspection_id}`}>Local files</h3>
        <table className="files-table">
          <thead>
            <tr>
              <th scope="col">File name</th>
              <th scope="col">Type</th>
              <th scope="col" className="center">
                Saved
              </th>
            </tr>
          </thead>
          <tbody>
            {localFiles(r).map((f) => {
              const S = FILE_STATE[f.state]
              const Kind = f.kind === 'JSON' ? FileJson : FileImage
              return (
                <tr key={f.name}>
                  <td>
                    <Kind size={15} aria-hidden="true" /> {f.name}
                  </td>
                  <td>{f.kind}</td>
                  <td className={`center file-${f.state}`} title={S.label}>
                    <S.icon size={17} aria-hidden="true" />
                    <span className="visually-hidden">{S.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <StorageLine result={r} onResultUpdate={onUpdate} />
      </section>

      {r.evidence.supporting_images.length > 0 && (
        <section className="stack-sm" aria-label="ภาพหลักฐานมุมอื่น">
          <h3>Evidence views</h3>
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
            ครอบคลุมที่ client รายงาน {r.evidence.reported_coverage_deg ?? '—'}° {r.evidence.verified_coverage ? '(Backend ยืนยันแล้ว)' : '(ยังไม่ยืนยัน)'}
          </p>
        </section>
      )}

      <ReviewPanel r={r} onUpdate={onUpdate} />
    </div>
  )
}
