// API client กลางของเว็บ (ตกลง shape กับ 04 ก่อนแก้) — ห้ามสร้าง client ซ้ำในหน้าอื่น
import type {
  ApiErrorBody,
  HealthStatus,
  InspectionFilters,
  InspectionPage,
  InspectionRequest,
  InspectionResult,
  LocateLabelResult,
  ProductCatalog,
  ProductId,
  ReviewRequest,
  SourceMode,
} from '../types/inspection'
import { API_BASE_URL } from './config'

export { API_BASE_URL }

export type ApiErrorKind = 'http' | 'network' | 'aborted' | 'config' | 'invalid_response'

/** ข้อผิดพลาดของระบบ (ERROR) — ไม่ใช่ผลสินค้า FAIL */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly requestId: string | null

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; code?: string; requestId?: string | null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status ?? null
    this.code = opts.code ?? kind
    this.requestId = opts.requestId ?? null
  }

  /** retry ด้วย payload เดิมมีโอกาสสำเร็จหรือไม่ */
  get retryable(): boolean {
    if (this.kind === 'network') return true
    return this.status === 503 || this.status === 502 || this.status === 504
  }
}

export function isAbort(err: unknown): boolean {
  return (err instanceof ApiError && err.kind === 'aborted') || (err instanceof DOMException && err.name === 'AbortError')
}

/** ข้อความสำหรับผู้ใช้ตามสถานะ HTTP ของ contract */
export function describeApiError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'เกิดข้อผิดพลาดที่ไม่คาดคิด ลองใหม่อีกครั้ง'
  switch (err.kind) {
    case 'config':
      return 'ยังไม่ได้ตั้ง VITE_API_BASE_URL ใน .env ที่ root แล้ว restart dev server'
    case 'network':
      return `ติดต่อ Backend ไม่ได้ที่ ${API_BASE_URL || '(ไม่ได้ตั้งค่า)'} ตรวจว่า Backend รันอยู่และ CORS ตรง origin`
    case 'invalid_response':
      return 'Backend ตอบกลับในรูปแบบที่ไม่ตรง contract'
    default:
      break
  }
  switch (err.status) {
    case 400:
    case 422:
      return `ข้อมูลหรือภาพไม่ถูกต้อง: ${err.message}`
    case 404:
      return 'ไม่พบรายการหรือภาพนี้'
    case 409:
      return 'คำขอนี้ถูกส่งแล้วด้วยข้อมูลต่างกัน เริ่มการตรวจรอบใหม่'
    case 413:
      return 'ไฟล์ใหญ่เกินกำหนด ลดขนาดหรือจำนวนภาพ'
    case 503:
      return 'ระบบตรวจยังไม่พร้อม ลองใหม่อีกครั้ง'
    default:
      return err.message || `Backend ตอบ ${err.status}`
  }
}

/** แปลง URL จาก API (เช่น /api/inspections/{id}/images/original) ให้ชี้ Backend */
export function resolveApiUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

/** Alias backward-compatible สำหรับ 04 */
export const resolveImageUrl = resolveApiUrl

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE_URL) throw new ApiError('config', 'VITE_API_BASE_URL is not set')
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers } })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('aborted', 'aborted')
    throw new ApiError('network', err instanceof Error ? err.message : 'network error')
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> | null = null
    try {
      body = (await res.json()) as Partial<ApiErrorBody>
    } catch {
      body = null
    }
    throw new ApiError('http', body?.error?.message ?? res.statusText, {
      status: res.status,
      code: body?.error?.code ?? `http_${res.status}`,
      requestId: body?.error?.request_id ?? null,
    })
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('invalid_response', 'response is not JSON', { status: res.status })
  }
}

/** สร้าง multipart ตามหัวข้อ "คำขอตรวจ" — เรียกซ้ำกับ request เดิมได้ payload เหมือนเดิม */
export function buildInspectionForm(req: InspectionRequest): FormData {
  const form = new FormData()
  form.append('image', req.image, req.imageName ?? 'image.jpg')
  form.append('expected_product', req.expected_product)
  form.append('source_mode', req.source_mode)
  form.append('client_request_id', req.client_request_id)
  if (req.angle_deg !== undefined) form.append('angle_deg', String(req.angle_deg))
  for (const [i, s] of (req.supporting_images ?? []).entries()) {
    form.append('supporting_images', s.blob, s.name ?? `supporting-${i}.jpg`)
  }
  if (req.evidence) form.append('evidence', JSON.stringify(req.evidence))
  if (req.demo !== undefined) form.append('demo', String(req.demo))
  return form
}

function query(filters: Partial<InspectionFilters>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthStatus>('/api/health', { signal }),

  products: (signal?: AbortSignal) => request<ProductCatalog>('/api/products', { signal }),

  locateLabel(image: Blob, expected: ProductId = 'bottle_a', signal?: AbortSignal) {
    const form = new FormData()
    form.append('image', image, 'frame.jpg')
    form.append('expected_product', expected)
    return request<LocateLabelResult>('/api/locate-label', { method: 'POST', body: form, signal })
  },

  createInspection: (req: InspectionRequest, signal?: AbortSignal) =>
    request<InspectionResult>('/api/inspections', { method: 'POST', body: buildInspectionForm(req), signal }),

  listInspections: (filters: InspectionFilters, signal?: AbortSignal) =>
    request<InspectionPage>(`/api/inspections${query(filters)}`, { signal }),

  getInspection: (id: string, signal?: AbortSignal) =>
    request<InspectionResult>(`/api/inspections/${encodeURIComponent(id)}`, { signal }),

  retrySave: (id: string, signal?: AbortSignal) =>
    request<InspectionResult>(`/api/inspections/${encodeURIComponent(id)}/retry-save`, { method: 'POST', signal }),

  review: (id: string, body: ReviewRequest, signal?: AbortSignal) =>
    request<InspectionResult>(`/api/inspections/${encodeURIComponent(id)}/review`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal,
    }),

  /** ลิงก์ CSV จาก Backend (ทุกแถวที่ตรง filter ไม่ตัดตาม page) */
  exportCsvUrl(filters: Omit<InspectionFilters, 'page' | 'page_size'>): string {
    return `${API_BASE_URL}/api/exports/inspections.csv${query(filters)}`
  },
}

// -----------------------------------------------------------------------------
// Backward-compatible individual function exports for 04 webcam module
// -----------------------------------------------------------------------------
export const getHealth = api.health
export const getProducts = api.products
export const getInspection = api.getInspection

export function locateLabel(
  imageBlob: Blob,
  expectedProduct: string = 'bottle_a',
  signal?: AbortSignal
): Promise<LocateLabelResult> {
  return api.locateLabel(imageBlob, expectedProduct, signal)
}

export interface SubmitInspectionParams {
  image: Blob
  expectedProduct: string
  sourceMode: SourceMode
  clientRequestId: string
  angleDeg?: number | null
  supportingImages?: Blob[]
  evidence?: Record<string, any>
  signal?: AbortSignal
  demo?: boolean
}

export async function submitInspection(params: SubmitInspectionParams): Promise<InspectionResult> {
  const req: InspectionRequest = {
    image: params.image,
    expected_product: params.expectedProduct,
    source_mode: params.sourceMode,
    client_request_id: params.clientRequestId,
    angle_deg: params.angleDeg ?? undefined,
    supporting_images: params.supportingImages?.map((blob, idx) => ({
      blob,
      name: `supporting-${idx}.jpg`,
    })),
    evidence: params.evidence as any,
    demo: params.demo,
  }
  return api.createInspection(req, params.signal)
}

export async function getInspections(params: {
  page?: number
  pageSize?: number
  result?: any
  productId?: string
  sourceMode?: SourceMode
  dateFrom?: string
  dateTo?: string
  demo?: boolean
  signal?: AbortSignal
} = {}): Promise<InspectionPage> {
  return api.listInspections(
    {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 10,
      result: params.result,
      product_id: params.productId,
      source_mode: params.sourceMode,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      demo: params.demo,
    },
    params.signal
  )
}
