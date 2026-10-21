import type { InspectionResult, SearchStatus } from '../api/contract'
import { ApiError, isApiError, type InspectionPort } from '../api/port'
import { validateJob, type ValidationIssue } from '../machine/evidence'
import { displayState, initialState, transition } from '../machine/machine'
import type {
  DisplayState,
  Effect,
  JobInput,
  MachineConfig,
  MachineEvent,
  MachineState,
  Phase,
  Route,
  SimError,
  ViewMode,
} from '../machine/types'

export type Station = 'conveyor' | 'camera_turntable' | 'pass_output' | 'reject_tray' | 'review_lane'

export interface SimulationSnapshot {
  state: DisplayState
  phase: Phase
  paused: boolean
  demo: boolean
  speed: number
  job_id: string | null
  inspection_id: string | null
  mode: ViewMode | null
  current_station: Station | null
  current_angle_deg: number | null
  orient: {
    tried_angles: Array<number | null>
    total: number
    current_view_index: number | null
    search_status: SearchStatus | null
  } | null
  primary_view_index: number | null
  /**
   * The real photo the locator is looking at right now (ORIENT), or null. Same Blob the user
   * uploaded; the page makes its own object URL.
   */
  current_image: Blob | null
  /**
   * The exact photo sent (or about to be sent) to POST /api/inspections, once chosen. Use it
   * with `result` (bbox, image_width/height) for the "Captured inspection image" panel.
   */
  captured_image: Blob | null
  /** Angle of captured_image, or null when unknown (single photo without angle). */
  captured_angle_deg: number | null
  result: InspectionResult | null
  route: Route | null
  error: SimError | null
  replaying: boolean
  /** True while a response for this job arrived during pause and waits for resume. */
  has_buffered_response: boolean
}

export interface CompletedEvent {
  job_id: string
  inspection_id: string
  result: InspectionResult
  route: Route
}

export interface ControllerOptions {
  port: InspectionPort
  config: MachineConfig
  /** Real-time network limits; independent of simulation speed. */
  locate_timeout_ms?: number
  inspect_timeout_ms?: number
  now?: () => number
  uuid?: () => string
}

type Listener<T> = (value: T) => void

/** Largest simulation step per frame, so a backgrounded tab does not teleport the bottle. */
const MAX_FRAME_DT_S = 0.1

export const SPEED_MIN = 0.25
export const SPEED_MAX = 3

/**
 * Runs the pure machine: feeds it ticks and responses, executes its effects, and owns
 * everything with side effects (AbortControllers, timeouts, listeners). One instance per
 * mounted scene; call destroy() on unmount.
 */
export class SimulationController {
  readonly port: InspectionPort
  private readonly config: MachineConfig
  private readonly locateTimeoutMs: number
  private readonly inspectTimeoutMs: number
  private readonly now: () => number
  private readonly uuid: () => string

  private state: MachineState = initialState()
  private speed = 1
  private destroyed = false
  private readonly inflight = new Set<AbortController>()
  private readonly completedIds = new Set<string>()
  private readonly snapshotListeners = new Set<Listener<SimulationSnapshot>>()
  private readonly completedListeners = new Set<Listener<CompletedEvent>>()
  private readonly replayedListeners = new Set<Listener<CompletedEvent>>()
  private snapshotKey = ''
  private snapshotCache: SimulationSnapshot | null = null

  constructor(options: ControllerOptions) {
    this.port = options.port
    this.config = options.config
    this.locateTimeoutMs = options.locate_timeout_ms ?? 15_000
    this.inspectTimeoutMs = options.inspect_timeout_ms ?? 30_000
    this.now = options.now ?? (() => performance.now())
    this.uuid = options.uuid ?? defaultUuid
  }

  // ---- commands -------------------------------------------------------------------------

  /** Returns validation issues; an empty array means the job started. */
  start(job: JobInput): ValidationIssue[] {
    if (this.destroyed) return []
    const issues = validateJob(job, this.config)
    if (issues.length > 0) return issues
    if (!this.canStart()) return []
    this.dispatch({ type: 'START', job, job_id: this.uuid(), client_request_id: this.uuid(), now: this.now() })
    return []
  }

  pause(): void {
    this.dispatch({ type: 'PAUSE', now: this.now() })
  }

  resume(): void {
    this.dispatch({ type: 'RESUME', now: this.now() })
  }

  /** Abandons the current job. Requests are aborted where possible, but the backend may already have recorded it. */
  reset(): void {
    this.dispatch({ type: 'RESET' })
  }

  retry(): void {
    this.dispatch({ type: 'RETRY', now: this.now() })
  }

  /** Replays the animation of the stored result: no request, no completed event, no count. */
  replay(): void {
    this.dispatch({ type: 'REPLAY' })
  }

  setSpeed(speed: number): void {
    const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(speed) ? speed : 1))
    if (clamped === this.speed) return
    this.speed = clamped
    this.notify()
  }

  /** Advance the simulation clock by real seconds elapsed since the last frame. */
  tick(realDtSeconds: number): void {
    if (this.destroyed || this.state.paused || !this.state.motion) return
    const dt = Math.min(MAX_FRAME_DT_S, Math.max(0, realDtSeconds)) * this.speed
    if (dt <= 0) return
    this.dispatch({ type: 'TICK', dt, now: this.now() })
  }

  destroy(): void {
    if (this.destroyed) return
    this.dispatch({ type: 'RESET' })
    this.destroyed = true
    this.snapshotListeners.clear()
    this.completedListeners.clear()
    this.replayedListeners.clear()
  }

  // ---- queries --------------------------------------------------------------------------

  getState(): Readonly<MachineState> {
    return this.state
  }

  getSpeed(): number {
    return this.speed
  }

  canStart(): boolean {
    return !this.state.paused && (this.state.phase === 'IDLE' || this.state.phase === 'COMPLETE')
  }

  inflightCount(): number {
    return this.inflight.size
  }

  getSnapshot(): SimulationSnapshot {
    const key = this.computeKey()
    if (!this.snapshotCache || key !== this.snapshotKey) {
      this.snapshotCache = this.buildSnapshot()
      this.snapshotKey = key
    }
    return this.snapshotCache
  }

  onSnapshot(listener: Listener<SimulationSnapshot>): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  /** Fires exactly once per inspection_id, when the bottle reaches its destination. */
  onCompleted(listener: Listener<CompletedEvent>): () => void {
    this.completedListeners.add(listener)
    return () => this.completedListeners.delete(listener)
  }

  onReplayed(listener: Listener<CompletedEvent>): () => void {
    this.replayedListeners.add(listener)
    return () => this.replayedListeners.delete(listener)
  }

  // ---- internals ------------------------------------------------------------------------

  private dispatch(event: MachineEvent): void {
    if (this.destroyed) return
    const { state, effects } = transition(this.state, event, this.config)
    const changed = state !== this.state
    this.state = state
    for (const effect of effects) this.run(effect)
    if (changed) this.notify()
  }

  private run(effect: Effect): void {
    switch (effect.type) {
      case 'ABORT_REQUESTS':
        for (const controller of this.inflight) controller.abort()
        this.inflight.clear()
        return
      case 'LOCATE': {
        const { token, attempt } = effect
        this.request(
          (signal) => this.port.locateLabel(effect.request, signal),
          this.locateTimeoutMs,
          (response) => this.dispatch({ type: 'LOCATE_OK', token, attempt, response, now: this.now() }),
          (error) => this.dispatch({ type: 'LOCATE_FAIL', token, attempt, error: toSimError('locate', error), now: this.now() }),
        )
        return
      }
      case 'INSPECT': {
        const { token } = effect
        this.request(
          (signal) => this.port.createInspection(effect.request, signal),
          this.inspectTimeoutMs,
          (result) => this.dispatch({ type: 'INSPECT_OK', token, result, now: this.now() }),
          (error) => this.dispatch({ type: 'INSPECT_FAIL', token, error: toSimError('inspect', error), now: this.now() }),
        )
        return
      }
      case 'COMPLETED': {
        const id = effect.result.inspection_id
        if (this.completedIds.has(id)) return
        this.completedIds.add(id)
        const payload: CompletedEvent = { job_id: effect.job_id, inspection_id: id, result: effect.result, route: effect.route }
        for (const listener of this.completedListeners) listener(payload)
        return
      }
      case 'REPLAYED': {
        const payload: CompletedEvent = {
          job_id: effect.job_id,
          inspection_id: effect.result.inspection_id,
          result: effect.result,
          route: effect.route,
        }
        for (const listener of this.replayedListeners) listener(payload)
        return
      }
    }
  }

  private request<T>(
    call: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    onOk: (value: T) => void,
    onFail: (error: ApiError) => void,
  ): void {
    const controller = new AbortController()
    this.inflight.add(controller)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const settle = () => {
      clearTimeout(timer)
      this.inflight.delete(controller)
    }
    let promise: Promise<T>
    try {
      promise = call(controller.signal)
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise.then(
      (value) => {
        const aborted = controller.signal.aborted
        settle()
        if (aborted) {
          // A late answer after our own timeout is still an operational timeout; after reset it is dropped by token.
          if (timedOut) onFail(new ApiError('timeout', 'หมดเวลารอคำตอบจาก API'))
          return
        }
        onOk(value)
      },
      (error: unknown) => {
        settle()
        if (timedOut) {
          onFail(new ApiError('timeout', 'หมดเวลารอคำตอบจาก API'))
          return
        }
        if (controller.signal.aborted) return // our own abort (reset/unmount): nothing to report
        onFail(isApiError(error) ? error : new ApiError('network', describe(error)))
      },
    )
  }

  private notify(): void {
    if (this.snapshotListeners.size === 0) return
    const key = this.computeKey()
    if (key === this.snapshotKey && this.snapshotCache) return
    const snapshot = this.getSnapshot()
    for (const listener of this.snapshotListeners) listener(snapshot)
  }

  /** Changes only on meaningful events, not on every animation frame. */
  private computeKey(): string {
    const s = this.state
    return [
      s.token,
      s.phase,
      s.paused ? 1 : 0,
      s.orient?.cursor ?? '',
      s.orient?.sub ?? '',
      s.orient?.tried.length ?? '',
      s.orient?.status ?? '',
      s.plan?.primary_view_index ?? '',
      s.result?.inspection_id ?? '',
      s.error?.code ?? '',
      s.replaying ? 1 : 0,
      s.buffered.length,
      this.speed,
      s.motion?.kind ?? '',
    ].join('|')
  }

  private buildSnapshot(): SimulationSnapshot {
    const s = this.state
    const job = s.job
    const orient = s.orient
    const currentViewIndex =
      orient && job ? (job.search_order[orient.cursor] ?? null) : s.plan ? s.plan.primary_view_index : null
    return {
      state: displayState(s),
      phase: s.phase,
      paused: s.paused !== null,
      demo: this.port.demo,
      speed: this.speed,
      job_id: job?.job_id ?? null,
      inspection_id: s.result?.inspection_id ?? null,
      mode: job?.mode ?? null,
      current_station: stationOf(s.phase, s.route),
      current_angle_deg:
        job && currentViewIndex !== null ? (job.views[currentViewIndex]?.angle_deg ?? null) : null,
      orient:
        orient && job
          ? {
              tried_angles: orient.tried.map((a) => job.views[a.view_index]?.angle_deg ?? null),
              total: job.search_order.length,
              current_view_index: s.phase === 'ORIENT' ? currentViewIndex : null,
              search_status: orient.status,
            }
          : null,
      primary_view_index: s.plan?.primary_view_index ?? null,
      current_image:
        s.phase === 'ORIENT' && job && currentViewIndex !== null ? (job.views[currentViewIndex]?.image ?? null) : null,
      captured_image: s.request?.image ?? null,
      captured_angle_deg: s.request ? (s.request.angle_deg ?? null) : null,
      result: s.result,
      route: s.route,
      error: s.error,
      replaying: s.replaying,
      has_buffered_response: s.buffered.length > 0,
    }
  }
}

export function stationOf(phase: Phase, route: Route | null): Station | null {
  switch (phase) {
    case 'IDLE':
      return null
    case 'FEED':
    case 'SORT':
      return 'conveyor'
    case 'ORIENT':
    case 'SETTLE':
    case 'INSPECT':
    case 'WAIT_RESULT':
    case 'ERROR':
      return 'camera_turntable'
    case 'OUTPUT':
    case 'COMPLETE':
      return route === 'reject' ? 'reject_tray' : route === 'review' ? 'review_lane' : 'pass_output'
  }
}

function toSimError(source: 'locate' | 'inspect', error: ApiError): SimError {
  return {
    source,
    kind: error.kind,
    status: error.status,
    code: error.code,
    message: error.message,
    request_id: error.requestId,
    retryable: error.retryable,
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'เชื่อมต่อ API ไม่สำเร็จ'
}

function defaultUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // RFC 4122 v4 fallback for non-secure contexts (e.g. http://LAN-IP during demos).
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
