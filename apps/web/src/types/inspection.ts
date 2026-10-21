// Shared contract ตาม docs/api-contract.md v0.2 (เจ้าของร่วม 01/03/04)
// แก้ไฟล์นี้เมื่อ contract เปลี่ยนเท่านั้น และอัปเดต examples + consumer พร้อมกันใน PR เดียว

export type ProductId = string // ชั่วคราว: 'bottle_a' | 'bottle_b' จนทีมเลือกสินค้าจริง
export type SourceMode = 'simulation' | 'webcam'
export type InspectionResultValue = 'PASS' | 'FAIL' | 'REVIEW'
export type StorageStatus = 'pending' | 'saved' | 'failed'

export const REASONS = {
  PASS: ['good'],
  FAIL: ['wrong_label', 'misplaced_label', 'missing_label'],
  REVIEW: ['blurred_image', 'label_not_visible', 'unknown_product', 'ambiguous_match', 'orientation_failed'],
} as const

export type PassReason = (typeof REASONS.PASS)[number]
export type FailReason = (typeof REASONS.FAIL)[number]
export type ReviewReason = (typeof REASONS.REVIEW)[number]
export type InspectionReason = PassReason | FailReason | ReviewReason

export type LocatorReason = 'usable_view' | 'blurred_image' | 'label_not_visible' | 'orientation_failed'

/** pixel ของภาพต้นฉบับหลังแก้ EXIF orientation ไม่ใช่ CSS pixel */
export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export type EvidenceKind = 'single_view' | 'multi_view'
export type SearchStatus = 'not_requested' | 'usable_view_found' | 'exhausted' | 'timed_out'

/** evidence ที่ client ส่งไปกับ POST /api/inspections (JSON string) */
export interface EvidenceRequest {
  kind: EvidenceKind
  search_status: SearchStatus
  supporting_angles_deg: Array<number | null>
  reported_coverage_deg: number | null
}

/** evidence ที่ backend ส่งกลับ */
export interface EvidenceResponse extends EvidenceRequest {
  verified_coverage: boolean
  required_view_profile: string | null
  /** ยาวเท่า supporting_angles_deg; null ณ index ที่ยังเขียนไม่สำเร็จ ห้ามกรองออก */
  supporting_images: Array<string | null>
}

export interface TimingMs {
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

export interface InspectionResult {
  inspection_id: string
  client_request_id: string
  created_at: string // UTC ISO-8601
  source_mode: SourceMode
  expected_product: ProductId
  detected_product: ProductId | null
  result: InspectionResultValue
  reason: InspectionReason
  /** similarity 0..1 ไม่ใช่ calibrated confidence */
  match_score: number | null
  score_method: 'template_ccoeff_normed_clamped_v1' | string | null
  bbox: BBox | null
  expected_bbox: BBox | null
  image_width: number
  image_height: number
  orientation_deg: number | null
  timing_ms: TimingMs
  config_version: string
  storage_status: StorageStatus
  storage_error: StorageError | null
  images: { original: string | null; annotated: string | null }
  evidence: EvidenceResponse
  reviewed_result: InspectionResultValue | null
  reviewed_reason: InspectionReason | null
  reviewer: string | null
  reviewed_at: string | null
  /** true เฉพาะข้อมูลสังเคราะห์ใน examples/ หรือโหมดจำลอง */
  demo?: boolean
  is_demo?: boolean
}

export interface LocateLabelResult {
  usable_view: boolean
  bbox: BBox | null
  image_width: number
  image_height: number
  quality: { sharp_enough: boolean; label_visible: boolean; bottle_visible: boolean }
  reason: LocatorReason
}

export interface Product {
  product_id: ProductId
  display_name: string
  brand?: string | null
  size_ml?: number | null
  validated?: boolean
}

export interface ProductCatalog {
  products: Product[]
  simulation_defaults?: { max_rotation_deg: number; rotation_step_deg: number }
  config_version?: string
  demo?: boolean
}

export interface HealthStatus {
  status: string
  config_version?: string
  timezone?: string
  storage_root_ready?: boolean
  detector_ready?: boolean
  detector_status?: string
  readiness_reason?: string | null
}

export interface InspectionFilters {
  page: number
  page_size: number
  source_mode?: SourceMode
  result?: InspectionResultValue
  /** หมายถึง expected_product */
  product_id?: ProductId
  /** YYYY-MM-DD ตาม APP_TIMEZONE รวมวันต้นและวันปลาย */
  date_from?: string
  date_to?: string
  demo?: boolean
  q?: string
  sort_by?: 'created_at' | 'expected_product' | 'result' | 'match_score' | string
  sort_order?: 'asc' | 'desc'
}

export interface InspectionFileItem {
  name: string
  kind: 'original' | 'annotated' | 'result_json' | 'supporting' | string
  available: boolean
  size_bytes?: number | null
  download_url?: string | null
}

export interface InspectionFilesResponse {
  inspection_id: string
  storage_status: StorageStatus
  all_available: boolean
  files: InspectionFileItem[]
  download_zip_url?: string | null
}

export interface InspectionPage {
  items: InspectionResult[]
  total: number
  page: number
  page_size: number
}

export interface ReviewRequest {
  reviewed_result: InspectionResultValue
  reviewed_reason: InspectionReason
  reviewer: string
}

/** คำขอตรวจหนึ่งรอบ เก็บไว้ทั้งก้อนเพื่อ retry ด้วย payload เดิมและ id เดิม */
export interface InspectionRequest {
  image: Blob
  imageName?: string
  expected_product: ProductId
  source_mode: SourceMode
  client_request_id: string
  angle_deg?: number
  supporting_images?: Array<{ blob: Blob; name?: string }>
  evidence?: EvidenceRequest
  demo?: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string; request_id?: string }
}

// -----------------------------------------------------------------------------
// Backward-compatibility aliases for 04 webcam module
// -----------------------------------------------------------------------------
export type BoundingBox = BBox
export type LocateResult = LocateLabelResult
export type InspectionResultStatus = InspectionResultValue
export type InspectionTiming = TimingMs
export type InspectionEvidence = EvidenceResponse
export type ApiErrorResponse = ApiErrorBody
export type QualityAssessment = LocateLabelResult['quality']
export type CatalogProduct = Product
export type CatalogResponse = ProductCatalog
export type InspectionsListResponse = InspectionPage
