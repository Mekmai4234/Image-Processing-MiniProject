// โหมด DEMO: ใช้ข้อมูลสังเคราะห์จาก examples/ (demo=true) เพื่อพัฒนา UI ก่อน API จริงพร้อม
// ไม่ได้ตรวจภาพจริง ผลมาจาก "สถานการณ์" ที่ผู้ใช้เลือก และทุกหน้าต้องแสดงป้าย DEMO
import catalogJson from '../../../../examples/products.example.json'
import passJson from '../../../../examples/inspection-pass.json'
import failJson from '../../../../examples/inspection-fail.json'
import reviewJson from '../../../../examples/inspection-review.json'
import orientJson from '../../../../examples/inspection-orientation-review.json'
import { ApiError } from '../lib/api'
import { newRequestId } from '../lib/ids'
import type { DataSource } from '../lib/dataSource'
import type {
  InspectionFilters,
  InspectionRequest,
  InspectionResult,
  LocateLabelResult,
  ProductCatalog,
} from '../types/inspection'
import { syntheticImage } from './synthetic'

export const DEMO_EXAMPLES = [passJson, failJson, reviewJson, orientJson] as unknown as InspectionResult[]

export const DEMO_SCENARIOS = {
  pass: { label: 'PASS ฉลากถูกต้อง', base: 0 },
  wrong_label: { label: 'FAIL ฉลากผิดสินค้า', base: 1 },
  blurred: { label: 'REVIEW ภาพเบลอ', base: 2 },
  orientation_failed: { label: 'REVIEW หามุมไม่สำเร็จ', base: 3 },
  save_failed: { label: 'PASS แต่บันทึกไม่สำเร็จ', base: 0 },
  api_error: { label: 'ERROR ระบบตรวจไม่พร้อม (503)', base: -1 },
} as const

export type DemoScenario = keyof typeof DEMO_SCENARIOS

const LATENCY_MS = 900

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError('aborted', 'aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new ApiError('aborted', 'aborted'))
    })
  })
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function imagesFor(id: string) {
  return { original: `/api/inspections/${id}/images/original`, annotated: `/api/inspections/${id}/images/annotated` }
}

export function createDemoDataSource(getScenario: () => DemoScenario): DataSource {
  const store: InspectionResult[] = DEMO_EXAMPLES.map(clone)

  function find(id: string): InspectionResult {
    const r = store.find((x) => x.inspection_id === id)
    if (!r) throw new ApiError('http', 'not found', { status: 404, code: 'not_found' })
    return r
  }

  return {
    kind: 'demo',

    async health() {
      return { status: 'demo', config_version: catalogJson.config_version }
    },

    async products(): Promise<ProductCatalog> {
      return {
        ...clone(catalogJson),
        simulation_defaults: { max_rotation_deg: 360, rotation_step_deg: 30 },
      } as ProductCatalog
    },

    async locateLabel(_image, _expected, signal): Promise<LocateLabelResult> {
      await wait(250, signal)
      const s = getScenario()
      const base = passJson as unknown as InspectionResult
      const usable = s !== 'blurred' && s !== 'orientation_failed'
      return {
        usable_view: usable,
        bbox: usable ? base.bbox : null,
        image_width: base.image_width,
        image_height: base.image_height,
        quality: { sharp_enough: s !== 'blurred', label_visible: usable, bottle_visible: true },
        reason: s === 'blurred' ? 'blurred_image' : s === 'orientation_failed' ? 'label_not_visible' : 'usable_view',
      }
    },

    async createInspection(req: InspectionRequest, signal) {
      // idempotency แบบเดียวกับ backend: id เดิมคืนรายการเดิม
      const existing = store.find((x) => x.client_request_id === req.client_request_id)
      await wait(LATENCY_MS, signal)
      if (existing) return clone(existing)
      const scenario = getScenario()
      if (scenario === 'api_error') {
        throw new ApiError('http', 'inspection unavailable (DEMO)', { status: 503, code: 'inspection_unavailable', requestId: 'demo' })
      }
      const r = clone(DEMO_EXAMPLES[DEMO_SCENARIOS[scenario].base])
      const id = newRequestId()
      r.inspection_id = id
      r.client_request_id = req.client_request_id
      r.created_at = new Date().toISOString()
      r.source_mode = req.source_mode
      r.expected_product = req.expected_product
      if (r.reason === 'good') r.detected_product = req.expected_product
      if (r.reason === 'wrong_label') {
        r.detected_product = req.expected_product === 'bottle_a' ? 'bottle_b' : 'bottle_a'
      }
      r.images = imagesFor(id)
      r.evidence.supporting_images = r.evidence.supporting_images.map((_, i) => `/api/inspections/${id}/images/supporting/${i}`)
      if (scenario === 'save_failed') {
        r.storage_status = 'failed'
        r.storage_error = { code: 'storage_write_failed', message: 'เขียนไฟล์ลงดิสก์ไม่สำเร็จ (DEMO)', retryable: true }
        r.images = { original: null, annotated: null }
      }
      store.unshift(r)
      return clone(r)
    },

    async listInspections(f: InspectionFilters, signal) {
      await wait(350, signal)
      const items = store
        .filter((r) => !f.source_mode || r.source_mode === f.source_mode)
        .filter((r) => !f.result || r.result === f.result)
        .filter((r) => !f.product_id || r.expected_product === f.product_id)
        .filter((r) => f.demo === undefined || Boolean(r.demo || r.is_demo) === f.demo)
        // ช่วงวันเวลาไทย รวมวันต้นและวันปลาย (เหมือนกติกา backend)
        .filter((r) => !f.date_from || Date.parse(r.created_at) >= Date.parse(`${f.date_from}T00:00:00+07:00`))
        .filter((r) => !f.date_to || Date.parse(r.created_at) < Date.parse(`${f.date_to}T00:00:00+07:00`) + 86_400_000)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.inspection_id.localeCompare(a.inspection_id))
      const start = (f.page - 1) * f.page_size
      return { items: clone(items.slice(start, start + f.page_size)), total: items.length, page: f.page, page_size: f.page_size }
    },

    async getInspection(id, signal) {
      await wait(150, signal)
      return clone(find(id))
    },

    async retrySave(id, signal) {
      await wait(LATENCY_MS, signal)
      const r = find(id)
      r.storage_status = 'saved'
      r.storage_error = null
      r.images = imagesFor(id)
      return clone(r)
    },

    async review(id, body, signal) {
      await wait(300, signal)
      const r = find(id)
      r.reviewed_result = body.reviewed_result
      r.reviewed_reason = body.reviewed_reason
      r.reviewer = body.reviewer
      r.reviewed_at = new Date().toISOString()
      return clone(r)
    },

    exportCsvUrl() {
      return null // CSV ต้องมาจาก Backend จริงเท่านั้น
    },

    imageUrl(result, kind) {
      if (typeof kind === 'object') {
        const angle = result.evidence.supporting_angles_deg[kind.supporting]
        return result.evidence.supporting_images[kind.supporting] ? syntheticImage(result, { angle: angle ?? 90 }) : null
      }
      if (!result.images[kind]) return null
      return syntheticImage(result, { annotated: kind === 'annotated' })
    },
  }
}
