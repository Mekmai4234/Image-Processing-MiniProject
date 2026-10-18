import type {
  CatalogResponse,
  InspectionResult,
  InspectionsListResponse,
  LocateResult,
  SourceMode,
} from '../types/inspection'

/**
 * Base API URL resolved from Vite environment or default localhost
 */
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
export const API_BASE_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl

export class ApiError extends Error {
  code: string
  status: number
  requestId?: string

  constructor(message: string, status: number, code: string = 'api_error', requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorJson: any = null
    try {
      errorJson = await res.json()
    } catch {
      // response was not JSON
    }
    const errorDetail = errorJson?.error
    const message = errorDetail?.message || `HTTP error ${res.status}: ${res.statusText}`
    const code = errorDetail?.code || `http_${res.status}`
    const requestId = errorDetail?.request_id
    throw new ApiError(message, res.status, code, requestId)
  }
  return res.json() as Promise<T>
}

/**
 * Resolve an image path from the backend to a fully qualified URL
 */
export function resolveImageUrl(pathOrUrl: string | null): string | null {
  if (!pathOrUrl) return null
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl
  }
  return `${API_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}

/**
 * Health check
 */
export async function getHealth(signal?: AbortSignal): Promise<{ status: string; config_version?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/health`, { signal })
  return handleResponse(res)
}

/**
 * Fetch catalog products
 */
export async function getProducts(signal?: AbortSignal): Promise<CatalogResponse> {
  const res = await fetch(`${API_BASE_URL}/api/products`, { signal })
  return handleResponse(res)
}

/**
 * Locate label on a single video frame (for real-time locator feedback)
 */
export async function locateLabel(
  imageBlob: Blob,
  expectedProduct: string = 'bottle_a',
  signal?: AbortSignal
): Promise<LocateResult> {
  const formData = new FormData()
  formData.append('image', imageBlob, 'frame.jpg')
  formData.append('expected_product', expectedProduct)

  const res = await fetch(`${API_BASE_URL}/api/locate-label`, {
    method: 'POST',
    body: formData,
    signal,
  })
  return handleResponse<LocateResult>(res)
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
}

/**
 * Submit captured image for full inspection & persistence
 */
export async function submitInspection(params: SubmitInspectionParams): Promise<InspectionResult> {
  const formData = new FormData()
  formData.append('image', params.image, 'capture.jpg')
  formData.append('expected_product', params.expectedProduct)
  formData.append('source_mode', params.sourceMode)
  formData.append('client_request_id', params.clientRequestId)

  if (params.angleDeg !== undefined && params.angleDeg !== null) {
    formData.append('angle_deg', params.angleDeg.toString())
  }

  if (params.supportingImages && params.supportingImages.length > 0) {
    for (const sup of params.supportingImages) {
      formData.append('supporting_images', sup, 'supporting.jpg')
    }
  }

  if (params.evidence) {
    formData.append('evidence', JSON.stringify(params.evidence))
  }

  const res = await fetch(`${API_BASE_URL}/api/inspections`, {
    method: 'POST',
    body: formData,
    signal: params.signal,
  })
  return handleResponse<InspectionResult>(res)
}

/**
 * Fetch inspection history with pagination and filters
 */
export async function getInspections(params: {
  page?: number
  pageSize?: number
  result?: string
  productId?: string
  sourceMode?: string
  dateFrom?: string
  dateTo?: string
  signal?: AbortSignal
} = {}): Promise<InspectionsListResponse> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', params.page.toString())
  if (params.pageSize) query.set('page_size', params.pageSize.toString())
  if (params.result) query.set('result', params.result)
  if (params.productId) query.set('product_id', params.productId)
  if (params.sourceMode) query.set('source_mode', params.sourceMode)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const url = `${API_BASE_URL}/api/inspections?${query.toString()}`
  const res = await fetch(url, { signal: params.signal })
  return handleResponse<InspectionsListResponse>(res)
}

/**
 * Fetch a single inspection detail
 */
export async function getInspection(id: string, signal?: AbortSignal): Promise<InspectionResult> {
  const res = await fetch(`${API_BASE_URL}/api/inspections/${id}`, { signal })
  return handleResponse<InspectionResult>(res)
}
