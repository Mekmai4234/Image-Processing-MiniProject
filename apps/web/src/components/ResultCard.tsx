import { HardDrive, Info, Loader2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { describeApiError } from '../lib/api'
import { useAppData } from '../lib/AppData'
import { formatMs, formatSimilarity, MODE_LABEL, productName, REASON_LABEL, STORAGE_LABEL } from '../lib/format'
import type { RunState } from '../lib/useInspectionRun'
import type { InspectionResult } from '../types/inspection'
import { DemoTag, ResultBadge } from './ResultBadge'

interface Props {
  state: RunState
  onRetry(): void
  onResultUpdate(r: InspectionResult): void
  idleText: string
}

/** การ์ดผลตรวจ: แสดงผลสินค้าและสถานะบันทึกแยกกัน */
export function ResultCard({ state, onRetry, onResultUpdate, idleText }: Props) {
  if (state.phase === 'idle') {
    return <p className="hint">{idleText}</p>
  }
  if (state.phase === 'checking') {
    return (
      <div className="result-card" aria-live="polite" aria-busy="true">
        <div className="verdict">
          <Loader2 size={20} className="spin" aria-hidden="true" />
          <div>
            <div className="reason">กำลังตรวจ…</div>
            <small>ยังไม่มีผล จนกว่า Backend จะตอบกลับ</small>
          </div>
        </div>
        <div className="skeleton" />
        <div className="skeleton" style={{ width: '70%' }} />
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div className="result-card" data-tone="ERROR" role="alert">
        <div className="verdict">
          <ResultBadge result="ERROR" size="lg" />
          <div>
            <div className="reason">ตรวจไม่สำเร็จ ไม่ใช่ผลสินค้า</div>
            <small>{state.message}</small>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={onRetry}>
            <RotateCcw size={16} aria-hidden="true" /> ลองส่งคำขอเดิมอีกครั้ง
          </button>
          {state.requestId && <span className="hint">request_id: {state.requestId}</span>}
        </div>
        {!state.retryable && <p className="hint">ถ้ายังไม่สำเร็จ ให้ตรวจข้อมูลหรือเริ่มรอบใหม่</p>}
      </div>
    )
  }
  return <ResultDetails result={state.result} onResultUpdate={onResultUpdate} />
}

export function ResultDetails({ result: r, onResultUpdate }: { result: InspectionResult; onResultUpdate(r: InspectionResult): void }) {
  const { products } = useAppData()
  return (
    <div className="result-card" data-tone={r.result} aria-live="polite">
      <div className="verdict">
        <ResultBadge result={r.result} size="lg" />
        <div>
          <div className="reason">{REASON_LABEL[r.reason] ?? r.reason}</div>
          <small>
            {r.result === 'REVIEW' ? 'ต้องคัดออกหรือถ่ายใหม่ ไม่นับเป็นผ่าน' : r.reason}
            {r.demo && (
              <>
                {' '}
                <DemoTag />
              </>
            )}
          </small>
        </div>
      </div>

      <dl className="facts">
        <dt>สินค้าที่คาดหวัง</dt>
        <dd>{productName(products, r.expected_product)}</dd>
        <dt>สินค้าที่ตรวจพบ</dt>
        <dd>{productName(products, r.detected_product)}</dd>
        <dt>
          ความคล้าย{' '}
          <span title="template similarity (OpenCV TM_CCOEFF_NORMED ที่ตัดค่าติดลบเป็น 0) ไม่ใช่โอกาสที่คำตอบถูก">
            <Info size={13} aria-label="วิธีคำนวณ" />
          </span>
        </dt>
        <dd>{formatSimilarity(r.match_score)}</dd>
        <dt>โหมด</dt>
        <dd>{MODE_LABEL[r.source_mode]}</dd>
        <dt>เวลาตรวจ</dt>
        <dd>{formatMs(r.timing_ms.inspection)}</dd>
        <dt>config</dt>
        <dd>{r.config_version}</dd>
      </dl>
      {r.evidence.kind === 'multi_view' && (
        <p className="hint">
          หลักฐาน {r.evidence.supporting_images.length + 1} มุม{' '}
          {r.evidence.verified_coverage ? '(ยืนยันครบด้านตาม profile)' : '(ยังไม่ยืนยันว่าครบทุกด้าน)'}
        </p>
      )}
      <StorageLine result={r} onResultUpdate={onResultUpdate} />
    </div>
  )
}

export function StorageLine({ result: r, onResultUpdate }: { result: InspectionResult; onResultUpdate(r: InspectionResult): void }) {
  const { ds } = useAppData()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function retrySave() {
    setBusy(true)
    setErr(null)
    try {
      onResultUpdate(await ds.retrySave(r.inspection_id))
    } catch (e) {
      setErr(describeApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm">
      <div className={`storage ${r.storage_status}`}>
        <HardDrive size={15} aria-hidden="true" />
        <span>
          {r.result} / {STORAGE_LABEL[r.storage_status]}
        </span>
        {r.storage_status === 'failed' && r.storage_error?.retryable && (
          <button className="btn btn-sm" onClick={retrySave} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} บันทึกซ้ำ
          </button>
        )}
      </div>
      {r.storage_status === 'failed' && r.storage_error && (
        <p className="hint">
          {r.storage_error.message}
          {!r.storage_error.retryable && ' ไม่มีภาพต้นทางให้กู้ ถ่ายหรืออัปโหลดใหม่'}
        </p>
      )}
      {err && <p className="hint" role="alert">{err}</p>}
    </div>
  )
}
