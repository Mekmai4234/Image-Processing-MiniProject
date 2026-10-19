import type {
  EvidenceRequest,
  InspectionResult,
  LocateLabelResponse,
  ProductId,
  ProductsResponse,
} from './contract'

/**
 * Everything the simulation needs from the backend. The real adapter wraps 01's shared API
 * client; the mock adapter is DEMO-only. The simulation never talks to fetch directly.
 */
export interface InspectionPort {
  /** True for synthetic adapters; the scene must show a DEMO badge while this is true. */
  readonly demo: boolean
  getProducts(signal?: AbortSignal): Promise<ProductsResponse>
  locateLabel(request: LocateLabelRequest, signal: AbortSignal): Promise<LocateLabelResponse>
  createInspection(request: InspectionRequest, signal: AbortSignal): Promise<InspectionResult>
}

export interface LocateLabelRequest {
  image: Blob
  expected_product: ProductId
}

/**
 * Multipart fields for POST /api/inspections. Built exactly once per job and reused unchanged
 * on retry, so the same client_request_id always travels with the same payload.
 */
export interface InspectionRequest {
  image: Blob
  expected_product: ProductId
  source_mode: 'simulation'
  client_request_id: string
  /** Omitted (undefined) when the main image angle is unknown. */
  angle_deg?: number
  supporting_images: Blob[]
  evidence: EvidenceRequest
}

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response'

/** Operational failure. Never converted into a product verdict. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly requestId: string | null

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number | null; code?: string; requestId?: string | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status ?? null
    this.code = options.code ?? kind
    this.requestId = options.requestId ?? null
  }

  /**
   * Whether repeating the identical request can succeed. 400/413/422 mean the input itself is
   * wrong and 409 means the id was already used with a different payload, so retrying the same
   * bytes is pointless; those require a reset.
   */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true
    if (this.kind === 'http') return this.status === null || this.status >= 500 || this.status === 429
    return false
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}
