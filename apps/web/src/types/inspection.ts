/**
 * Shared inspection contract types conforming to docs/api-contract.md v0.2
 */

export type SourceMode = 'simulation' | 'webcam'
export type InspectionResultStatus = 'PASS' | 'FAIL' | 'REVIEW'
export type StorageStatus = 'pending' | 'saved' | 'failed'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface QualityAssessment {
  sharp_enough: boolean
  label_visible: boolean
  bottle_visible: boolean
}

export interface LocateResult {
  usable_view: boolean
  bbox: BoundingBox | null
  image_width: number
  image_height: number
  quality: QualityAssessment
  reason: 'usable_view' | 'blurred_image' | 'label_not_visible' | 'orientation_failed' | string
}

export interface InspectionTiming {
  orientation: number
  inspection: number
  storage: number
  total: number
}

export interface StorageError {
  code: string
  message: string
  retryable: boolean
}

export interface InspectionEvidence {
  kind: 'single_view' | 'multi_view'
  search_status: 'not_requested' | 'usable_view_found' | 'exhausted' | 'timed_out'
  supporting_angles_deg: (number | null)[]
  reported_coverage_deg: number | null
  verified_coverage: boolean
  required_view_profile: string | null
  supporting_images: (string | null)[]
}

export interface InspectionResult {
  inspection_id: string
  client_request_id: string
  created_at: string
  source_mode: SourceMode
  expected_product: string
  detected_product: string | null
  result: InspectionResultStatus
  reason: string
  match_score: number | null
  score_method: string | null
  bbox: BoundingBox | null
  expected_bbox: BoundingBox | null
  image_width: number
  image_height: number
  orientation_deg: number | null
  timing_ms: InspectionTiming
  config_version: string
  storage_status: StorageStatus
  images: {
    original: string | null
    annotated: string | null
  }
  evidence: InspectionEvidence
  storage_error: StorageError | null
  reviewed_result: InspectionResultStatus | null
  reviewed_reason: string | null
  reviewer: string | null
  reviewed_at: string | null
  demo?: boolean
}

export interface CatalogProduct {
  product_id: string
  display_name: string
  required_views?: number
}

export interface CatalogResponse {
  products: CatalogProduct[]
  simulation_defaults?: {
    max_rotation_deg: number
    rotation_step_deg: number
  }
}

export interface InspectionsListResponse {
  items: InspectionResult[]
  total: number
  page: number
  page_size: number
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    request_id?: string
  }
}
