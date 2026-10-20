import { useCallback, useEffect, useRef, useState } from 'react'
import type { InspectionRequest, InspectionResult } from '../types/inspection'
import { ApiError, describeApiError, isAbort } from './api'
import type { DataSource } from './dataSource'

/** state ของหน้า: idle → checking → result | error (ตาม 01_web_ui/process.txt) */
export type RunState =
  | { phase: 'idle' }
  | { phase: 'checking'; request: InspectionRequest }
  | { phase: 'result'; request: InspectionRequest; result: InspectionResult }
  | { phase: 'error'; request: InspectionRequest; message: string; retryable: boolean; requestId: string | null }

/**
 * ส่งคำขอตรวจหนึ่งรอบ และตัดผลเก่าทิ้งเมื่อผู้ใช้เปลี่ยนภาพ/สินค้า/รีเซ็ต
 * - run(request) = รอบใหม่ (ผู้เรียกต้องสร้าง client_request_id ใหม่)
 * - retry() = ส่ง payload เดิมด้วย id เดิม
 * - reset() = ยกเลิกคำขอค้างและล้างผล
 */
export function useInspectionRun(ds: DataSource) {
  const [state, setState] = useState<RunState>({ phase: 'idle' })
  const ctrlRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)

  const send = useCallback(
    async (request: InspectionRequest) => {
      ctrlRef.current?.abort()
      const ctrl = new AbortController()
      ctrlRef.current = ctrl
      const seq = ++seqRef.current
      setState({ phase: 'checking', request })
      try {
        const result = await ds.createInspection(request, ctrl.signal)
        if (seq !== seqRef.current) return // ผลของรอบเก่า ทิ้ง
        setState({ phase: 'result', request, result })
      } catch (err) {
        if (isAbort(err) || seq !== seqRef.current) return
        setState({
          phase: 'error',
          request,
          message: describeApiError(err),
          retryable: err instanceof ApiError ? err.retryable : false,
          requestId: err instanceof ApiError ? err.requestId : null,
        })
      }
    },
    [ds],
  )

  const reset = useCallback(() => {
    seqRef.current++
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setState({ phase: 'idle' })
  }, [])

  const retry = useCallback(() => {
    if (state.phase === 'error') void send(state.request)
  }, [send, state])

  /** อัปเดตผลหลัง retry-save โดยไม่เปลี่ยนคำตัดสิน */
  const replaceResult = useCallback((result: InspectionResult) => {
    setState((s) => (s.phase === 'result' && s.result.inspection_id === result.inspection_id ? { ...s, result } : s))
  }, [])

  // แหล่งข้อมูลเปลี่ยน (live/demo) หรือออกจากหน้า = ทิ้งคำขอค้าง
  useEffect(() => reset, [ds, reset])

  return { state, run: send, retry, reset, replaceResult }
}
