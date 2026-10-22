import { describe, expect, it } from 'vitest'
import type { InspectionResult } from '../types/inspection'
import { addCompleted, EMPTY_STATS, percentOf, pipelineStage, PIPELINE_STAGES, simErrorText } from './simSession'

const r = (id: string, result: InspectionResult['result']) => ({ inspection_id: id, result }) as InspectionResult

describe('สถิติรอบนี้', () => {
  it('นับแยก PASS/FAIL/REVIEW', () => {
    let s = EMPTY_STATS
    s = addCompleted(s, r('a', 'PASS'))
    s = addCompleted(s, r('b', 'FAIL'))
    s = addCompleted(s, r('c', 'REVIEW'))
    expect([s.total, s.pass, s.fail, s.review]).toEqual([3, 1, 1, 1])
  })

  it('inspection_id เดิมไม่นับซ้ำ', () => {
    const once = addCompleted(EMPTY_STATS, r('a', 'PASS'))
    expect(addCompleted(once, r('a', 'PASS'))).toBe(once)
  })

  it('สัดส่วนไม่มีข้อมูล = null ไม่ใช่ 0%', () => {
    expect(percentOf(0, 0)).toBeNull()
    expect(percentOf(120, 128)).toBe('93.8%')
  })
})

describe('ขั้นใน pipeline', () => {
  const at = (phase: string, station: string | null = null) => pipelineStage({ phase, current_station: station })

  it('ยังไม่มีฉาก/IDLE = ยังไม่เริ่ม', () => {
    expect(pipelineStage(null)).toEqual({ index: -1, error: false })
    expect(at('IDLE').index).toBe(-1)
  })

  it('จับคู่ phase กับขั้น', () => {
    expect(at('FEED').index).toBe(0)
    expect(at('SETTLE').index).toBe(1)
    expect(at('WAIT_RESULT').index).toBe(2)
    expect(at('SORT').index).toBe(3)
    expect(at('OUTPUT').index).toBe(4)
    expect(at('COMPLETE').index).toBe(PIPELINE_STAGES.length)
  })

  it('ERROR ชี้ขั้นตามตำแหน่งขวด', () => {
    expect(at('ERROR', 'orient_turntable')).toEqual({ index: 1, error: true })
    expect(at('ERROR', 'inspect_camera')).toEqual({ index: 2, error: true })
  })
})

describe('ข้อความ error ของฉาก', () => {
  it('ใช้ข้อความไทยตามสถานะ HTTP เหมือนทั้งเว็บ', () => {
    expect(simErrorText({ kind: 'http', status: 503, code: 'http_503', message: 'Service Unavailable' })).toBe('ระบบตรวจยังไม่พร้อม ลองใหม่อีกครั้ง')
  })

  it('kind ที่ client กลางไม่รู้จักใช้ข้อความของฉาก', () => {
    expect(simErrorText({ kind: 'timeout', status: null, code: 'timeout', message: 'หมดเวลารอผล' })).toBe('หมดเวลารอผล')
  })
})
