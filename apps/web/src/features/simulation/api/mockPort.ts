import {
  DEMO_SIMULATION_DEFAULTS,
  type InspectionResult,
  type LocateLabelResponse,
  type ProductsResponse,
} from './contract'
import { ApiError, type InspectionPort, type InspectionRequest, type LocateLabelRequest } from './port'

/**
 * DEMO-only backend stand-in for unit tests and harnesses. The app itself uses
 * createDataSourcePort(ds) so DEMO/live follows 01's DataSource. Every result it
 * returns carries demo:true and the scene shows a DEMO badge. It does not look at pixels: the
 * scenario decides the answer. Nothing here may be presented as a real inspection.
 */
export type MockVerdict =
  | 'PASS'
  | 'FAIL_WRONG_LABEL'
  | 'FAIL_MISPLACED'
  | 'REVIEW_BLURRED'
  | 'HTTP_503'
  | 'HTTP_422'
  | 'NETWORK'
  | 'HANG'

export interface MockScenario {
  /** Verdict when the evidence is sufficient (single view, or a usable view was found). */
  verdict: MockVerdict
  /** 1-based locate call (per job) that reports a usable view; null = never usable. */
  usable_at_attempt: number | null
  locate_delay_ms: number
  inspect_delay_ms: number
  /** Number of initial inspect calls (per client_request_id) that fail with 503 before succeeding. */
  inspect_failures_before_success: number
  /** 1-based locate call that fails once with 503. */
  locate_fail_at_attempt: number | null
}

export const DEFAULT_SCENARIO: MockScenario = {
  verdict: 'PASS',
  usable_at_attempt: 2,
  locate_delay_ms: 350,
  inspect_delay_ms: 900,
  inspect_failures_before_success: 0,
  locate_fail_at_attempt: null,
}

export interface MockCallLog {
  locate: LocateLabelRequest[]
  inspect: InspectionRequest[]
}

const OTHER_PRODUCT: Record<string, string> = { bottle_a: 'bottle_b', bottle_b: 'bottle_a' }

export class MockInspectionPort implements InspectionPort {
  readonly demo = true
  scenario: MockScenario
  readonly calls: MockCallLog = { locate: [], inspect: [] }
  private locateCounter = 0
  private readonly idempotency = new Map<string, { signature: string; result: InspectionResult }>()
  private readonly failuresServed = new Map<string, number>()
  private serial = 0

  constructor(scenario: Partial<MockScenario> = {}) {
    this.scenario = { ...DEFAULT_SCENARIO, ...scenario }
  }

  setScenario(patch: Partial<MockScenario>): void {
    this.scenario = { ...this.scenario, ...patch }
  }

  /** Call when a new job starts so usable_at_attempt counts per job. */
  resetLocateCounter(): void {
    this.locateCounter = 0
  }

  async getProducts(signal?: AbortSignal): Promise<ProductsResponse> {
    await delay(50, signal)
    return {
      demo: true,
      config_version: 'demo-v0',
      simulation_defaults: { ...DEMO_SIMULATION_DEFAULTS },
      products: [
        { product_id: 'bottle_a', display_name: 'Bottle A — รอเลือกยี่ห้อและรุ่นจริง', brand: null, size_ml: null, validated: false },
        { product_id: 'bottle_b', display_name: 'Bottle B — รอเลือกยี่ห้อและรุ่นจริง', brand: null, size_ml: null, validated: false },
      ],
    }
  }

  async locateLabel(request: LocateLabelRequest, signal: AbortSignal): Promise<LocateLabelResponse> {
    this.calls.locate.push(request)
    this.locateCounter += 1
    const attempt = this.locateCounter
    await delay(this.scenario.locate_delay_ms, signal)
    if (this.scenario.locate_fail_at_attempt === attempt) {
      throw new ApiError('http', 'DEMO: locator unavailable (503)', { status: 503, code: 'inspection_unavailable', requestId: `demo-${attempt}` })
    }
    const usable = this.scenario.usable_at_attempt !== null && attempt >= this.scenario.usable_at_attempt
    return {
      usable_view: usable,
      bbox: usable ? { x: 120, y: 180, width: 160, height: 100 } : null,
      image_width: 400,
      image_height: 500,
      quality: { sharp_enough: true, label_visible: usable, bottle_visible: true },
      reason: usable ? 'usable_view' : 'label_not_visible',
    }
  }

  async createInspection(request: InspectionRequest, signal: AbortSignal): Promise<InspectionResult> {
    this.calls.inspect.push(request)
    const signature = signatureOf(request)
    const known = this.idempotency.get(request.client_request_id)
    await delay(this.scenario.verdict === 'HANG' ? 3_600_000 : this.scenario.inspect_delay_ms, signal)
    if (known) {
      if (known.signature !== signature) {
        throw new ApiError('http', 'DEMO: client_request_id reused with a different payload (409)', { status: 409, code: 'idempotency_conflict' })
      }
      return known.result
    }
    const served = this.failuresServed.get(request.client_request_id) ?? 0
    if (served < this.scenario.inspect_failures_before_success) {
      this.failuresServed.set(request.client_request_id, served + 1)
      throw new ApiError('http', 'DEMO: inspection unavailable (503)', { status: 503, code: 'inspection_unavailable', requestId: `demo-r${served}` })
    }
    switch (this.scenario.verdict) {
      case 'HTTP_503':
        throw new ApiError('http', 'DEMO: inspection unavailable (503)', { status: 503, code: 'inspection_unavailable', requestId: 'demo-503' })
      case 'HTTP_422':
        throw new ApiError('http', 'DEMO: invalid image (422)', { status: 422, code: 'invalid_image', requestId: 'demo-422' })
      case 'NETWORK':
        throw new ApiError('network', 'DEMO: network unreachable')
      default:
        break
    }
    const result = this.buildResult(request)
    this.idempotency.set(request.client_request_id, { signature, result })
    return result
  }

  private buildResult(request: InspectionRequest): InspectionResult {
    this.serial += 1
    const id = `00000000-0000-4000-8000-${String(100000000000 + this.serial).slice(-12)}`
    const expected = request.expected_product
    const searchFailed = request.evidence.search_status === 'exhausted' || request.evidence.search_status === 'timed_out'
    const base: InspectionResult = {
      inspection_id: id,
      client_request_id: request.client_request_id,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source_mode: 'simulation',
      expected_product: expected,
      detected_product: expected,
      result: 'PASS',
      reason: 'good',
      match_score: 0.94,
      score_method: 'template_ccoeff_normed_clamped_v1',
      bbox: { x: 120, y: 180, width: 160, height: 100 },
      expected_bbox: { x: 112, y: 165, width: 176, height: 130 },
      image_width: 400,
      image_height: 500,
      orientation_deg: request.angle_deg ?? null,
      timing_ms: { orientation: 0, inspection: 420, storage: 30, total: 450 },
      config_version: 'demo-v0',
      storage_status: 'saved',
      storage_error: null,
      images: {
        original: `/api/inspections/${id}/images/original`,
        annotated: `/api/inspections/${id}/images/annotated`,
      },
      evidence: {
        ...request.evidence,
        verified_coverage: false,
        required_view_profile: null,
        supporting_images: request.supporting_images.map((_, i) => `/api/inspections/${id}/images/supporting/${i}`),
      },
      reviewed_result: null,
      reviewed_reason: null,
      reviewer: null,
      reviewed_at: null,
      demo: true,
    }
    // Mirrors the contract: insufficient search evidence → REVIEW orientation_failed, decided by "backend".
    if (searchFailed) {
      return { ...base, result: 'REVIEW', reason: 'orientation_failed', detected_product: null, match_score: null, score_method: null, bbox: null }
    }
    switch (this.scenario.verdict) {
      case 'FAIL_WRONG_LABEL':
        return { ...base, result: 'FAIL', reason: 'wrong_label', detected_product: OTHER_PRODUCT[expected] ?? 'bottle_b', match_score: 0.91 }
      case 'FAIL_MISPLACED':
        return { ...base, result: 'FAIL', reason: 'misplaced_label', match_score: 0.88, bbox: { x: 150, y: 260, width: 150, height: 96 } }
      case 'REVIEW_BLURRED':
        return { ...base, result: 'REVIEW', reason: 'blurred_image', detected_product: null, match_score: null, score_method: null, bbox: null }
      default:
        return base
    }
  }
}

const blobIds = new WeakMap<Blob, number>()
let blobSerial = 0
function blobId(blob: Blob): number {
  let id = blobIds.get(blob)
  if (id === undefined) {
    blobSerial += 1
    id = blobSerial
    blobIds.set(blob, id)
  }
  return id
}

/** Same images (by identity) in the same order + same fields = same payload. */
function signatureOf(request: InspectionRequest): string {
  return JSON.stringify({
    image: blobId(request.image),
    supporting: request.supporting_images.map((s) => blobId(s.blob)),
    expected_product: request.expected_product,
    source_mode: request.source_mode,
    angle_deg: request.angle_deg ?? null,
    evidence: request.evidence,
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('aborted', 'aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ApiError('aborted', 'aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
