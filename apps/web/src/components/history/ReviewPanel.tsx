import { Clock3, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { describeApiError } from '../../lib/api'
import { useAppData } from '../../lib/AppData'
import { formatThaiDateTime, REASON_LABEL, REASON_SHORT } from '../../lib/format'
import { REASONS, type InspectionReason, type InspectionResult, type InspectionResultValue } from '../../types/inspection'

/**
 * การตรวจทานโดยคน เก็บแยกจากคำตัดสินเดิมของระบบ (reviewed_* ไม่แก้ result/reason)
 * REVIEW ที่ยังไม่มีคนดู = กล่องเหลือง "Prediction awaiting human review" ตามภาพต้นแบบ
 */
export function ReviewPanel({ r, onUpdate }: { r: InspectionResult; onUpdate(r: InspectionResult): void }) {
  const { ds } = useAppData()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<InspectionResultValue>(r.result)
  const [reason, setReason] = useState<InspectionReason>(r.reason)
  const [reviewer, setReviewer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (r.reviewed_result) {
    return (
      <div className="review-callout done">
        <UserCheck size={20} aria-hidden="true" />
        <div>
          <strong>
            Reviewed: {r.reviewed_result}
            {r.reviewed_reason ? ` | ${REASON_SHORT[r.reviewed_reason]}` : ''}
          </strong>
          <p className="hint">
            โดย {r.reviewer}
            {r.reviewed_at ? ` เมื่อ ${formatThaiDateTime(r.reviewed_at)}` : ''} ผลของระบบเดิม ({r.result}) ยังเก็บไว้
          </p>
        </div>
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

  const awaiting = r.result === 'REVIEW'

  return (
    <div className={`review-callout ${awaiting ? 'awaiting' : ''}`}>
      <Clock3 size={20} aria-hidden="true" />
      <div className="review-body">
        <div className="row-between">
          <strong>{awaiting ? 'Prediction awaiting human review' : 'No human review yet'}</strong>
          {!open && (
            <button className="btn btn-sm" onClick={() => setOpen(true)}>
              Mark reviewed
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
            {err && (
              <p className="hint" role="alert">
                {err}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
