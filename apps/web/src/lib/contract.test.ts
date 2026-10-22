import { describe, expect, it } from 'vitest'
import { DEMO_EXAMPLES, createDemoDataSource } from '../demo/demoDataSource'
import { REASONS, type InspectionRequest } from '../types/inspection'
import { buildInspectionForm } from './api'
import { formatSimilarity, todayInBangkok, formatThaiDateTime } from './format'

describe('format', () => {
  it('score null แสดง —', () => {
    expect(formatSimilarity(null)).toBe('—')
    expect(formatSimilarity(0.914)).toBe('91%')
  })
  it('วันที่ filter ใช้เวลาไทย', () => {
    // 2026-10-18 20:00 UTC = 19 ต.ค. 03:00 เวลาไทย
    expect(todayInBangkok(new Date('2026-10-18T20:00:00Z'))).toBe('2026-10-19')
  })
  it('แสดง created_at เป็นเวลาไทย', () => {
    expect(formatThaiDateTime('2026-10-18T07:28:01Z')).toContain('14:28:01')
  })
})

describe('buildInspectionForm', () => {
  const req: InspectionRequest = {
    image: new Blob(['x'], { type: 'image/jpeg' }),
    expected_product: 'bottle_a',
    source_mode: 'simulation',
    client_request_id: '10000000-0000-4000-8000-0000000000aa',
    angle_deg: 0,
    supporting_images: [{ blob: new Blob(['a']) }, { blob: new Blob(['b']) }],
    evidence: { kind: 'multi_view', search_status: 'not_requested', supporting_angles_deg: [90, null], reported_coverage_deg: null },
  }

  it('ส่ง field ตาม contract และ supporting_images ซ้ำตามลำดับ', () => {
    const f = buildInspectionForm(req)
    expect(f.get('expected_product')).toBe('bottle_a')
    expect(f.get('source_mode')).toBe('simulation')
    expect(f.get('client_request_id')).toBe(req.client_request_id)
    expect(f.getAll('supporting_images')).toHaveLength(2)
    expect(JSON.parse(String(f.get('evidence'))).supporting_angles_deg).toEqual([90, null])
  })

  it('retry สร้าง payload เดิม', () => {
    const a = buildInspectionForm(req)
    const b = buildInspectionForm(req)
    expect([...a.keys()]).toEqual([...b.keys()])
    expect(a.get('client_request_id')).toBe(b.get('client_request_id'))
  })
})

describe('DEMO data', () => {
  it('ทุก example ประกาศ demo=true และ reason ตรงกับ result', () => {
    for (const r of DEMO_EXAMPLES) {
      expect(r.demo).toBe(true)
      expect((REASONS[r.result] as readonly string[]).includes(r.reason)).toBe(true)
    }
  })

  it('client_request_id เดิมคืนรายการเดิม (idempotent)', async () => {
    const ds = createDemoDataSource(() => 'pass')
    const req = {
      image: new Blob(['x']),
      expected_product: 'bottle_a',
      source_mode: 'webcam' as const,
      client_request_id: '10000000-0000-4000-8000-0000000000bb',
    }
    const a = await ds.createInspection(req)
    const b = await ds.createInspection(req)
    expect(b.inspection_id).toBe(a.inspection_id)
  })

  it('save failure ไม่เปลี่ยนผลสินค้า', async () => {
    const ds = createDemoDataSource(() => 'save_failed')
    const r = await ds.createInspection({
      image: new Blob(['x']),
      expected_product: 'bottle_b',
      source_mode: 'webcam',
      client_request_id: '10000000-0000-4000-8000-0000000000cc',
    })
    expect(r.result).toBe('PASS')
    expect(r.storage_status).toBe('failed')
    expect(r.storage_error?.retryable).toBe(true)
  })

  it('CSV ไม่สร้างจาก mock', () => {
    expect(createDemoDataSource(() => 'pass').exportCsvUrl({})).toBeNull()
  })

  it('getInspectionFiles ใน DEMO สะท้อนตาม storage_status', async () => {
    const dsSaved = createDemoDataSource(() => 'pass')
    const saved = await dsSaved.createInspection({
      image: new Blob(['x']),
      expected_product: 'bottle_a',
      source_mode: 'webcam',
      client_request_id: '10000000-0000-4000-8000-0000000000dd',
    })
    const filesSaved = await dsSaved.getInspectionFiles(saved.inspection_id)
    expect(filesSaved.storage_status).toBe('saved')
    expect(filesSaved.all_available).toBe(true)
    expect(filesSaved.files.every((f) => f.available)).toBe(true)
    expect(filesSaved.download_zip_url).toBeTruthy()

    const dsFailed = createDemoDataSource(() => 'save_failed')
    const failed = await dsFailed.createInspection({
      image: new Blob(['x']),
      expected_product: 'bottle_a',
      source_mode: 'webcam',
      client_request_id: '10000000-0000-4000-8000-0000000000ee',
    })
    const filesFailed = await dsFailed.getInspectionFiles(failed.inspection_id)
    expect(filesFailed.storage_status).toBe('failed')
    expect(filesFailed.all_available).toBe(false)
    expect(filesFailed.files.every((f) => !f.available)).toBe(true)
    expect(filesFailed.download_zip_url).toBeNull()
  })

  it('DEMO listInspections รองรับการค้นหา q และการเรียงลำดับ sort_by/sort_order', async () => {
    const ds = createDemoDataSource(() => 'pass')
    // Search with q
    const resPass = await ds.listInspections({ page: 1, page_size: 10, q: 'bottle_a' })
    expect(resPass.items.length).toBeGreaterThan(0)
    expect(resPass.items.every((it) => it.expected_product.includes('bottle_a') || it.inspection_id.includes('bottle_a'))).toBe(true)

    // Sort by match_score asc and desc
    const resDesc = await ds.listInspections({ page: 1, page_size: 10, sort_by: 'match_score', sort_order: 'desc' })
    const resAsc = await ds.listInspections({ page: 1, page_size: 10, sort_by: 'match_score', sort_order: 'asc' })
    expect(resDesc.items[0]?.match_score ?? 0).toBeGreaterThanOrEqual(resDesc.items[resDesc.items.length - 1]?.match_score ?? 0)
    expect(resAsc.items[0]?.match_score ?? 0).toBeLessThanOrEqual(resAsc.items[resAsc.items.length - 1]?.match_score ?? 0)
  })
})
