import type { EvidenceRequest, LocateLabelResponse, SearchStatus } from '../api/contract'
import type { InspectionRequest } from '../api/port'
import type {
  InspectionPlan,
  Job,
  JobInput,
  JobView,
  LocateAttempt,
  MachineConfig,
  ViewMode,
} from './types'

export interface ValidationIssue {
  code:
    | 'no_product'
    | 'no_views'
    | 'too_many_views'
    | 'invalid_image'
    | 'invalid_angle'
    | 'missing_angle'
    | 'duplicate_angle'
  message: string
  view_index?: number
}

const isAngle = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360

/**
 * Checks a job before START. A multi-view set needs a real, distinct angle for every photo,
 * because ORIENT turns the model to those angles; it never invents angles that were not shot.
 */
export function validateJob(input: JobInput, config: MachineConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeof input.expected_product !== 'string' || input.expected_product.trim() === '') {
    issues.push({ code: 'no_product', message: 'เลือกสินค้าที่คาดหวังก่อนเริ่ม' })
  }
  const views = Array.isArray(input.views) ? input.views : []
  if (views.length === 0) {
    issues.push({ code: 'no_views', message: 'ต้องมีภาพจริงอย่างน้อย 1 ภาพ' })
    return issues
  }
  if (views.length > config.max_views) {
    issues.push({
      code: 'too_many_views',
      message: `ภาพรวมต่อคำขอได้ไม่เกิน ${config.max_views} ภาพ (MAX_INSPECTION_VIEWS)`,
    })
  }
  const seen = new Set<number>()
  views.forEach((view, index) => {
    if (!(view.image instanceof Blob) || view.image.size === 0) {
      issues.push({ code: 'invalid_image', message: `ภาพที่ ${index + 1} ว่างหรือไม่ใช่ไฟล์`, view_index: index })
    }
    if (view.angle_deg === null) {
      if (views.length > 1) {
        issues.push({
          code: 'missing_angle',
          message: `ภาพที่ ${index + 1} ต้องระบุมุมจริงเมื่อใช้ชุดหลายมุม`,
          view_index: index,
        })
      }
      return
    }
    if (!isAngle(view.angle_deg)) {
      issues.push({ code: 'invalid_angle', message: `มุมของภาพที่ ${index + 1} ต้องอยู่ในช่วง 0 ถึงน้อยกว่า 360`, view_index: index })
      return
    }
    if (seen.has(view.angle_deg)) {
      issues.push({ code: 'duplicate_angle', message: `มุม ${view.angle_deg}° ซ้ำกัน`, view_index: index })
    }
    seen.add(view.angle_deg)
  })
  return issues
}

/**
 * Orders the photos for ORIENT: ascending angle, starting from the smallest, keeping only
 * those reachable within max_rotation_deg of the first. Nothing beyond the uploaded set is used.
 */
export function searchOrder(views: JobView[], maxRotationDeg: number): { order: number[]; skipped: number[] } {
  const sorted = [...views].sort((a, b) => (a.angle_deg ?? 0) - (b.angle_deg ?? 0) || a.index - b.index)
  const first = sorted[0]?.angle_deg ?? 0
  const order: number[] = []
  const skipped: number[] = []
  for (const view of sorted) {
    if ((view.angle_deg ?? 0) - first <= maxRotationDeg) order.push(view.index)
    else skipped.push(view.index)
  }
  return { order, skipped }
}

export function buildJob(input: JobInput, jobId: string, clientRequestId: string, config: MachineConfig): Job {
  const views: JobView[] = input.views.map((view, index) => ({ ...view, index }))
  const mode: ViewMode = views.length > 1 ? 'multi_view' : 'single_view'
  const { order, skipped } = mode === 'multi_view' ? searchOrder(views, config.max_rotation_deg) : { order: [0], skipped: [] }
  return {
    job_id: jobId,
    client_request_id: clientRequestId,
    expected_product: input.expected_product,
    views,
    mode,
    search_order: order,
    skipped_views: skipped,
  }
}

/**
 * Picks the main image when no usable view was found. The locator gives booleans only (no
 * confidence), so rank by them: bottle visible counts most, then sharpness and label
 * visibility. Ties keep the earliest tried photo, which is the smallest angle.
 */
export function selectRepresentative(tried: LocateAttempt[]): number {
  let best = tried[0]
  let bestScore = -1
  for (const attempt of tried) {
    const score = qualityScore(attempt.response)
    if (score > bestScore) {
      best = attempt
      bestScore = score
    }
  }
  if (!best) throw new Error('selectRepresentative needs at least one attempt')
  return best.view_index
}

function qualityScore(response: LocateLabelResponse): number {
  const q = response.quality
  return (q.bottle_visible ? 2 : 0) + (q.sharp_enough ? 1 : 0) + (q.label_visible ? 1 : 0)
}

/**
 * Client-reported coverage (never proof of coverage): the span the turntable swept across the
 * searched angles plus one average step. 0/90/180/270 → 360; 0/30/60 → 90. Null when fewer
 * than two known angles were searched.
 */
export function reportedCoverage(angles: Array<number | null>): number | null {
  if (angles.some((a) => a === null)) return null
  const known = [...new Set(angles as number[])].sort((a, b) => a - b)
  if (known.length < 2) return null
  const first = known[0] as number
  const last = known[known.length - 1] as number
  const span = last - first
  return Math.min(360, span + span / (known.length - 1))
}

/** Decides main/supporting images once ORIENT ends (or immediately for a single photo). */
export function planInspection(job: Job, status: SearchStatus, tried: LocateAttempt[], foundViewIndex: number | null): InspectionPlan {
  if (job.mode === 'single_view') {
    return { primary_view_index: 0, supporting_view_indices: [], search_status: 'not_requested' }
  }
  if (status === 'usable_view_found' && foundViewIndex !== null) {
    // Decision Q1 (2026-10-19): send only the usable photo.
    return { primary_view_index: foundViewIndex, supporting_view_indices: [], search_status: status }
  }
  const primary = selectRepresentative(tried)
  const supporting = tried.map((a) => a.view_index).filter((index) => index !== primary)
  return { primary_view_index: primary, supporting_view_indices: supporting, search_status: status }
}

export function buildEvidence(job: Job, plan: InspectionPlan): EvidenceRequest {
  const supportingAngles = plan.supporting_view_indices.map((i) => job.views[i]?.angle_deg ?? null)
  if (supportingAngles.length === 0) {
    return {
      kind: 'single_view',
      search_status: plan.search_status,
      supporting_angles_deg: [],
      reported_coverage_deg: null,
    }
  }
  const allAngles = [job.views[plan.primary_view_index]?.angle_deg ?? null, ...supportingAngles]
  return {
    kind: 'multi_view',
    search_status: plan.search_status,
    supporting_angles_deg: supportingAngles,
    reported_coverage_deg: reportedCoverage(allAngles),
  }
}

/** The one and only payload for this job. The images are the user's real photos, never scene renders. */
export function buildInspectionRequest(job: Job, plan: InspectionPlan): InspectionRequest {
  const primary = job.views[plan.primary_view_index]
  if (!primary) throw new Error('primary view missing')
  const request: InspectionRequest = {
    image: primary.image,
    expected_product: job.expected_product,
    source_mode: 'simulation',
    client_request_id: job.client_request_id,
    supporting_images: plan.supporting_view_indices.map((i) => {
      const view = job.views[i]
      if (!view) throw new Error('supporting view missing')
      return view.image
    }),
    evidence: buildEvidence(job, plan),
  }
  if (primary.angle_deg !== null) request.angle_deg = primary.angle_deg
  return Object.freeze(request)
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** Shape check for a locator response; malformed data becomes an operational error, not a guess. */
export function parseLocateResponse(value: unknown): LocateLabelResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const q = v.quality as Record<string, unknown> | undefined
  if (!isBool(v.usable_view) || typeof q !== 'object' || q === null) return null
  if (!isBool(q.sharp_enough) || !isBool(q.label_visible) || !isBool(q.bottle_visible)) return null
  const reasons = ['usable_view', 'blurred_image', 'label_not_visible', 'orientation_failed']
  if (typeof v.reason !== 'string' || !reasons.includes(v.reason)) return null
  return value as LocateLabelResponse
}
