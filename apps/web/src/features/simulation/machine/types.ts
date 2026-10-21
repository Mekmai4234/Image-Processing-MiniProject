import type {
  InspectionResult,
  LocateLabelResponse,
  ProductId,
  SearchStatus,
} from '../api/contract'
import type { InspectionRequest, LocateLabelRequest } from '../api/port'

/** Machine phases from docs/architecture.md. REVIEW is a verdict, never a phase. */
export type Phase =
  | 'IDLE'
  | 'FEED'
  | 'ORIENT'
  | 'SETTLE'
  | 'INSPECT'
  | 'WAIT_RESULT'
  | 'SORT'
  | 'OUTPUT'
  | 'COMPLETE'
  | 'ERROR'

/** What the UI shows: the phase, or PAUSED while the simulation clock is frozen. */
export type DisplayState = Phase | 'PAUSED'

export const PAUSABLE_PHASES: readonly Phase[] = [
  'FEED',
  'ORIENT',
  'SETTLE',
  'INSPECT',
  'WAIT_RESULT',
  'SORT',
  'OUTPUT',
]

/** Physical destination in the scene. FAIL → reject tray, REVIEW → re-shoot lane. */
export type Route = 'pass' | 'reject' | 'review'

export type ViewMode = 'single_view' | 'multi_view'

export interface JobViewInput {
  /** Known turntable angle of this real photo, 0..<360, or null if unknown (single view only). */
  angle_deg: number | null
  image: Blob
  /** Original file name, sent as the multipart file name. */
  name?: string
}

export interface JobInput {
  expected_product: ProductId
  views: JobViewInput[]
}

export interface JobView extends JobViewInput {
  index: number
}

export interface Job {
  job_id: string
  /** Generated with the job, first sent when INSPECT fires, reused unchanged on retry. */
  client_request_id: string
  expected_product: ProductId
  views: JobView[]
  mode: ViewMode
  /** View indices ORIENT will try, ascending by angle, limited by max_rotation_deg. */
  search_order: number[]
  /** Views not searched because they lie beyond max_rotation_deg. */
  skipped_views: number[]
}

export interface LocateAttempt {
  view_index: number
  response: LocateLabelResponse
}

export interface OrientProgress {
  /** Position in job.search_order currently being tried. */
  cursor: number
  sub: 'rotating' | 'locating'
  /** Monotonic counter matching a locate response to the request that asked for it. */
  attempt: number
  tried: LocateAttempt[]
  /** Real (wall-clock) ms when the search started. */
  started_at: number
  /** Real ms spent paused or in ERROR, excluded from the search budget. */
  excluded_ms: number
  status: SearchStatus | null
  found_view_index: number | null
}

export type SegmentKind =
  | 'feed'
  | 'rotate'
  | 'to_inspect'
  | 'settle'
  | 'capture'
  | 'to_divert'
  | 'output'

export interface Motion {
  kind: SegmentKind
  /** Simulation seconds elapsed in this segment. */
  elapsed: number
  /** Simulation seconds the segment lasts at 1x speed. */
  duration: number
  /** For 'rotate': start and end model angles in degrees. */
  from_deg?: number
  to_deg?: number
}

export type ErrorSource = 'locate' | 'inspect'

export interface SimError {
  source: ErrorSource
  kind: string
  status: number | null
  code: string
  message: string
  request_id: string | null
  retryable: boolean
}

/** Which view became the main image and why, decided once ORIENT finishes. */
export interface InspectionPlan {
  primary_view_index: number
  supporting_view_indices: number[]
  search_status: SearchStatus
}

export interface MachineState {
  phase: Phase
  /** Non-null while paused; `since` is real ms. */
  paused: { since: number } | null
  /** Bumped on every START and RESET. Any event carrying another token is stale. */
  token: number
  job: Job | null
  orient: OrientProgress | null
  /** Current displayed model rotation in degrees. */
  angle_deg: number
  motion: Motion | null
  plan: InspectionPlan | null
  /** Built exactly once per job. Retry resends this same object. */
  request: InspectionRequest | null
  result: InspectionResult | null
  route: Route | null
  error: SimError | null
  /** Phase to return to on RETRY, and real ms the error began (excluded from search budget). */
  error_from: { phase: 'ORIENT' | 'WAIT_RESULT'; since: number } | null
  /** Results that arrived while paused, applied on RESUME. */
  buffered: MachineEvent[]
  /** True while re-playing the animation of an already-recorded result. */
  replaying: boolean
}

export type MachineEvent =
  | { type: 'START'; job: JobInput; job_id: string; client_request_id: string; now: number }
  | { type: 'TICK'; dt: number; now: number }
  | { type: 'LOCATE_OK'; token: number; attempt: number; response: unknown; now: number }
  | { type: 'LOCATE_FAIL'; token: number; attempt: number; error: SimError; now: number }
  | { type: 'INSPECT_OK'; token: number; result: unknown; now: number }
  | { type: 'INSPECT_FAIL'; token: number; error: SimError; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'RESET' }
  | { type: 'RETRY'; now: number }
  | { type: 'REPLAY' }

export type Effect =
  | { type: 'LOCATE'; token: number; attempt: number; view_index: number; request: LocateLabelRequest }
  | { type: 'INSPECT'; token: number; request: InspectionRequest }
  | { type: 'ABORT_REQUESTS' }
  | { type: 'COMPLETED'; token: number; job_id: string; result: InspectionResult; route: Route }
  | { type: 'REPLAYED'; token: number; job_id: string; result: InspectionResult; route: Route }

export interface Transition {
  state: MachineState
  effects: Effect[]
}

export interface MachineConfig {
  max_rotation_deg: number
  rotation_step_deg: number
  max_views: number
  /** Real-time budget for the whole orientation search, excluding pause/error time. */
  orient_budget_ms: number
}
