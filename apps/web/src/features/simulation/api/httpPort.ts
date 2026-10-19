import type { ApiErrorBody, InspectionResult, LocateLabelResponse, ProductsResponse } from './contract'
import { ApiError, type InspectionPort, type InspectionRequest, type LocateLabelRequest } from './port'

/**
 * Interim HTTP adapter following docs/api-contract.md v0.2. When 01's shared client
 * (src/lib/api.ts) exists, implement InspectionPort on top of it and delete this file, so the
 * app keeps one API client. Base URL comes from the caller (VITE_API_BASE_URL in the app).
 */
export function createHttpInspectionPort(baseUrl: string, fetchImpl: typeof fetch = fetch): InspectionPort {
  const root = baseUrl.replace(/\/+$/, '')

  async function send<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(`${root}${path}`, init)
    } catch (error) {
      if (init.signal?.aborted) throw new ApiError('aborted', 'aborted')
      throw new ApiError('network', error instanceof Error ? error.message : 'เชื่อมต่อ API ไม่สำเร็จ')
    }
    if (!response.ok) {
      let body: Partial<ApiErrorBody> | null = null
      try {
        body = (await response.json()) as Partial<ApiErrorBody>
      } catch {
        body = null
      }
      throw new ApiError('http', body?.error?.message ?? `HTTP ${response.status}`, {
        status: response.status,
        code: body?.error?.code ?? `http_${response.status}`,
        requestId: body?.error?.request_id ?? null,
      })
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new ApiError('invalid_response', 'API ตอบกลับไม่ใช่ JSON')
    }
  }

  return {
    demo: false,
    getProducts(signal) {
      return send<ProductsResponse>('/api/products', { method: 'GET', signal })
    },
    locateLabel(request: LocateLabelRequest, signal: AbortSignal) {
      const form = new FormData()
      form.append('image', request.image, fileName(request.image, 'locate'))
      form.append('expected_product', request.expected_product)
      return send<LocateLabelResponse>('/api/locate-label', { method: 'POST', body: form, signal })
    },
    createInspection(request: InspectionRequest, signal: AbortSignal) {
      const form = new FormData()
      form.append('image', request.image, fileName(request.image, 'main'))
      form.append('expected_product', request.expected_product)
      form.append('source_mode', request.source_mode)
      form.append('client_request_id', request.client_request_id)
      if (request.angle_deg !== undefined) form.append('angle_deg', String(request.angle_deg))
      request.supporting_images.forEach((blob, i) => form.append('supporting_images', blob, fileName(blob, `supporting-${i}`)))
      form.append('evidence', JSON.stringify(request.evidence))
      return send<InspectionResult>('/api/inspections', { method: 'POST', body: form, signal })
    },
  }
}

function fileName(blob: Blob, fallback: string): string {
  if (typeof File !== 'undefined' && blob instanceof File && blob.name) return blob.name
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  return `${fallback}.${ext}`
}
