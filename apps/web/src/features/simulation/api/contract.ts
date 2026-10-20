/**
 * Types that mirror docs/api-contract.md v0.2 field-for-field (snake_case).
 *
 * The shared file `apps/web/src/types/inspection.ts` (owned by 01/03/04) does not exist yet.
 * Until it does, this file is the single place the simulation reads contract shapes from.
 * When the shared file lands, replace these declarations with re-exports from it and do not
 * rename any field here.
 */

export type ProductId = string
export type SourceMode = 'simulation' | 'webcam'
export type InspectionVerdict = 'PASS' | 'FAIL' | 'REVIEW'
export type StorageStatus = 'pending' | 'saved' | 'failed'

export const REASONS_BY_RESULT = {
  PASS: ['good'],
  FAIL: ['wrong_label', 'misplaced_label', 'missing_label'],
  REVIEW: ['blurred_image', 'label_not_visible', 'unknown_product', 'ambiguous_match', 'orientation_failed'],
} as const satisfies Record<InspectionVerdict, readonly string[]>

export type InspectionReason = (typeof REASONS_BY_RESULT)[InspectionVerdict][number]

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export type EvidenceKind = 'single_view' | 'multi_view'
export type SearchStatus = 'not_requested' | 'usable_view_found' | 'exhausted' | 'timed_out'

/** The `evidence` JSON string sent with POST /api/inspections. */
export interface EvidenceRequest {
  kind: EvidenceKind
  search_status: SearchStatus
  supporting_angles_deg: Array<number | null>
  reported_coverage_deg: number | null
}

/** The `evidence` object returned inside InspectionResult. */
export interface EvidenceResponse extends EvidenceRequest {
  verified_coverage: boolean
  required_view_profile: string | null
  supporting_images: Array<string | null>
}

export interface SimulationDefaults {
  max_rotation_deg: number
  rotation_step_deg: number
}

export interface Product {
  product_id: ProductId
  display_name: string
  brand: string | null
  size_ml: number | null
  reference_paths: string[]
  validated: boolean
}

/** GET /api/products */
export interface ProductsResponse {
  demo?: boolean
  config_version: string
  products: Product[]
  simulation_defaults: SimulationDefaults
}

export type LocatorReason = 'usable_view' | 'blurred_image' | 'label_not_visible' | 'orientation_failed'

/** POST /api/locate-label — not an inspection verdict and never creates History. */
export interface LocateLabelResponse {
  usable_view: boolean
  bbox: BBox | null
  image_width: number
  image_height: number
  quality: {
    sharp_enough: boolean
    label_visible: boolean
    bottle_visible: boolean
  }
  reason: LocatorReason
}

export interface StorageError {
  code: string
  message: string
  retryable: boolean
}

/** POST /api/inspections and GET /api/inspections/{id} */
export interface InspectionResult {
  inspection_id: string
  client_request_id: string
  created_at: string
  source_mode: SourceMode
  expected_product: ProductId
  detected_product: ProductId | null
  result: InspectionVerdict
  reason: InspectionReason
  match_score: number | null
  score_method: string | null
  bbox: BBox | null
  expected_bbox: BBox | null
  image_width: number
  image_height: number
  orientation_deg: number | null
  timing_ms: {
    orientation: number
    inspection: number
    storage: number
    total: number
  }
  config_version: string
  storage_status: StorageStatus
  storage_error: StorageError | null
  images: {
    original: string | null
    annotated: string | null
  }
  evidence: EvidenceResponse
  reviewed_result: InspectionVerdict | null
  reviewed_reason: InspectionReason | null
  reviewer: string | null
  reviewed_at: string | null
  /** Present (true) on synthetic/mock data only. */
  demo?: boolean
}

/** Operational error body: {error:{code,message,request_id}} */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    request_id: string
  }
}

/** Contract limit: image + supporting_images per request (MAX_INSPECTION_VIEWS default). */
export const DEFAULT_MAX_INSPECTION_VIEWS = 12

/** docs/configuration.md defaults, used only when GET /api/products is unavailable in DEMO mode. */
export const DEMO_SIMULATION_DEFAULTS: SimulationDefaults = {
  max_rotation_deg: 360,
  rotation_step_deg: 30,
}
