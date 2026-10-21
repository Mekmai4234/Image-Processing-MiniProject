import { ApiError as SharedApiError, isAbort } from '../../../lib/api'
import type { DataSource } from '../../../lib/dataSource'
import { ApiError, type InspectionPort } from './port'

/**
 * Adapts 01's DataSource (live API or the DEMO store, chosen by the page) to the port the
 * simulation controller uses. No new HTTP client: every call goes through `ds`, so DEMO/live
 * switching, base URL and error handling stay in one place.
 */
export function createDataSourcePort(ds: DataSource): InspectionPort {
  return {
    demo: ds.kind === 'demo',
    getProducts: (signal) => wrap(() => ds.products(signal)),
    locateLabel: (request, signal) => wrap(() => ds.locateLabel(request.image, request.expected_product, signal)),
    createInspection: (request, signal) => wrap(() => ds.createInspection(request, signal)),
  }
}

async function wrap<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw toPortError(error)
  }
}

/** Maps the shared client's error onto the simulation's operational error (never a verdict). */
export function toPortError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isAbort(error)) return new ApiError('aborted', 'aborted')
  if (error instanceof SharedApiError) {
    const kind = error.kind === 'http' || error.kind === 'network' || error.kind === 'invalid_response' ? error.kind : 'network'
    return new ApiError(kind, error.message, { status: error.status, code: error.code, requestId: error.requestId })
  }
  return new ApiError('network', error instanceof Error && error.message ? error.message : 'เชื่อมต่อ API ไม่สำเร็จ')
}
