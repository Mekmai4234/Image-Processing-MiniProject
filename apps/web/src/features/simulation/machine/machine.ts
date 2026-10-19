import { REASONS_BY_RESULT, type InspectionResult, type InspectionVerdict, type SearchStatus } from '../api/contract'
import { buildInspectionRequest, buildJob, parseLocateResponse, planInspection, validateJob } from './evidence'
import {
  captureMotion,
  feedMotion,
  outputMotion,
  rotateMotion,
  settleMotion,
  toDivertMotion,
} from './motion'
import {
  PAUSABLE_PHASES,
  type DisplayState,
  type Effect,
  type MachineConfig,
  type MachineEvent,
  type MachineState,
  type OrientProgress,
  type Route,
  type SimError,
  type Transition,
} from './types'

export function initialState(token = 0): MachineState {
  return {
    phase: 'IDLE',
    paused: null,
    token,
    job: null,
    orient: null,
    angle_deg: 0,
    motion: null,
    plan: null,
    request: null,
    result: null,
    route: null,
    error: null,
    error_from: null,
    buffered: [],
    replaying: false,
  }
}

export function displayState(state: MachineState): DisplayState {
  return state.paused ? 'PAUSED' : state.phase
}

export function routeFor(verdict: InspectionVerdict): Route {
  if (verdict === 'PASS') return 'pass'
  if (verdict === 'FAIL') return 'reject'
  return 'review'
}

const same = (state: MachineState): Transition => ({ state, effects: [] })

/**
 * Pure transition function. No timers, no network, no Three.js. Every physical movement is a
 * motion segment advanced only by TICK, and every verdict arrives only through INSPECT_OK for
 * the current token. That is what makes "timer finished ⇒ PASS" impossible by construction.
 */
export function transition(state: MachineState, event: MachineEvent, config: MachineConfig): Transition {
  switch (event.type) {
    case 'START':
      return onStart(state, event, config)
    case 'RESET':
      return { state: initialState(state.token + 1), effects: [{ type: 'ABORT_REQUESTS' }] }
    case 'PAUSE':
      if (state.paused || !PAUSABLE_PHASES.includes(state.phase)) return same(state)
      return same({ ...state, paused: { since: event.now } })
    case 'RESUME':
      return onResume(state, event.now, config)
    case 'TICK':
      return onTick(state, event.dt, event.now)
    case 'LOCATE_OK':
    case 'LOCATE_FAIL':
    case 'INSPECT_OK':
    case 'INSPECT_FAIL':
      if (event.token !== state.token) return same(state) // stale: belongs to an abandoned job
      if (state.paused) return same({ ...state, buffered: [...state.buffered, event] })
      return onResponse(state, event, config)
    case 'RETRY':
      return onRetry(state, event.now)
    case 'REPLAY':
      return onReplay(state)
  }
}

function onStart(state: MachineState, event: Extract<MachineEvent, { type: 'START' }>, config: MachineConfig): Transition {
  if (state.paused || (state.phase !== 'IDLE' && state.phase !== 'COMPLETE')) return same(state)
  if (validateJob(event.job, config).length > 0) return same(state)
  const job = buildJob(event.job, event.job_id, event.client_request_id, config)
  return same({
    ...initialState(state.token + 1),
    phase: 'FEED',
    job,
    motion: feedMotion(),
  })
}

function onResume(state: MachineState, now: number, config: MachineConfig): Transition {
  if (!state.paused) return same(state)
  const pausedFor = Math.max(0, now - state.paused.since)
  let next: MachineState = {
    ...state,
    paused: null,
    buffered: [],
    orient: state.orient ? { ...state.orient, excluded_ms: state.orient.excluded_ms + pausedFor } : null,
  }
  const effects: Effect[] = []
  for (const buffered of state.buffered) {
    const result = transition(next, buffered, config)
    next = result.state
    effects.push(...result.effects)
  }
  return { state: next, effects }
}

function onTick(state: MachineState, dt: number, now: number): Transition {
  if (state.paused || !state.motion || !(dt > 0)) return same(state)
  const motion = { ...state.motion, elapsed: state.motion.elapsed + dt }
  let angle = state.angle_deg
  if (motion.kind === 'rotate' && motion.from_deg !== undefined && motion.to_deg !== undefined) {
    const t = Math.min(1, motion.elapsed / motion.duration)
    angle = motion.from_deg + (motion.to_deg - motion.from_deg) * t
  }
  const advanced: MachineState = { ...state, motion, angle_deg: angle }
  if (motion.elapsed < motion.duration) return same(advanced)
  return onSegmentDone(advanced, now)
}

function onSegmentDone(state: MachineState, now: number): Transition {
  const job = state.job
  const kind = state.motion?.kind
  if (!job || !kind) return same(state)

  switch (state.phase) {
    case 'FEED': {
      if (job.mode === 'single_view') {
        // Single photo: skip the search entirely; nothing on the far side is invented.
        const plan = planInspection(job, 'not_requested', [], null)
        return same({ ...state, phase: 'SETTLE', motion: settleMotion(), plan, request: buildInspectionRequest(job, plan) })
      }
      const orient: OrientProgress = {
        cursor: 0,
        sub: 'rotating',
        attempt: 0,
        tried: [],
        started_at: now,
        excluded_ms: 0,
        status: null,
        found_view_index: null,
      }
      return same({ ...state, phase: 'ORIENT', orient, motion: rotateMotion(state.angle_deg, angleOfCursor(state, 0)) })
    }
    case 'ORIENT': {
      if (!state.orient) return same(state)
      // Rotation reached the photo's real angle: ask the locator about that photo only.
      return issueLocate({ ...state, motion: null, angle_deg: angleOfCursor(state, state.orient.cursor) })
    }
    case 'SETTLE': {
      if (kind === 'rotate') return same({ ...state, motion: settleMotion() })
      return same({ ...state, phase: 'INSPECT', motion: captureMotion() })
    }
    case 'INSPECT': {
      if (!state.request) return same(state)
      return {
        state: { ...state, phase: 'WAIT_RESULT', motion: null },
        effects: [{ type: 'INSPECT', token: state.token, request: state.request }],
      }
    }
    case 'SORT': {
      const route = state.route
      if (!route) return same(state)
      return same({ ...state, phase: 'OUTPUT', motion: outputMotion(route) })
    }
    case 'OUTPUT': {
      const route = state.route
      const result = state.result
      if (!route || !result) return same(state)
      const effect: Effect = state.replaying
        ? { type: 'REPLAYED', token: state.token, job_id: job.job_id, result, route }
        : { type: 'COMPLETED', token: state.token, job_id: job.job_id, result, route }
      return { state: { ...state, phase: 'COMPLETE', motion: null, replaying: false }, effects: [effect] }
    }
    default:
      return same({ ...state, motion: null })
  }
}

function angleOfCursor(state: MachineState, cursor: number): number {
  const job = state.job
  const viewIndex = job?.search_order[cursor]
  const angle = viewIndex === undefined ? null : job?.views[viewIndex]?.angle_deg
  return angle ?? 0
}

function issueLocate(state: MachineState): Transition {
  const job = state.job
  const orient = state.orient
  if (!job || !orient) return same(state)
  const viewIndex = job.search_order[orient.cursor]
  const view = viewIndex === undefined ? undefined : job.views[viewIndex]
  if (!view) return same(state)
  const attempt = orient.attempt + 1
  return {
    state: { ...state, orient: { ...orient, sub: 'locating', attempt } },
    effects: [
      {
        type: 'LOCATE',
        token: state.token,
        attempt,
        view_index: view.index,
        request: { image: view.image, expected_product: job.expected_product },
      },
    ],
  }
}

function onResponse(
  state: MachineState,
  event: Extract<MachineEvent, { type: 'LOCATE_OK' | 'LOCATE_FAIL' | 'INSPECT_OK' | 'INSPECT_FAIL' }>,
  config: MachineConfig,
): Transition {
  switch (event.type) {
    case 'LOCATE_OK':
    case 'LOCATE_FAIL': {
      const orient = state.orient
      if (state.phase !== 'ORIENT' || !orient || orient.sub !== 'locating' || event.attempt !== orient.attempt) {
        return same(state)
      }
      if (event.type === 'LOCATE_FAIL') return toError(state, event.error, 'ORIENT', event.now)
      const response = parseLocateResponse(event.response)
      if (!response) {
        return toError(state, invalidResponse('locate', 'ผลจาก locate-label ไม่ตรงรูปแบบ contract'), 'ORIENT', event.now)
      }
      const job = state.job
      const viewIndex = job?.search_order[orient.cursor]
      if (!job || viewIndex === undefined) return same(state)
      const tried = [...orient.tried, { view_index: viewIndex, response }]
      if (response.usable_view) {
        return finishOrient(state, { ...orient, tried, found_view_index: viewIndex }, 'usable_view_found')
      }
      const nextCursor = orient.cursor + 1
      const hasMore = nextCursor < job.search_order.length
      const elapsed = event.now - orient.started_at - orient.excluded_ms
      if (hasMore && elapsed >= config.orient_budget_ms) {
        return finishOrient(state, { ...orient, tried }, 'timed_out')
      }
      if (!hasMore) return finishOrient(state, { ...orient, tried }, 'exhausted')
      return same({
        ...state,
        orient: { ...orient, tried, cursor: nextCursor, sub: 'rotating' },
        motion: rotateMotion(state.angle_deg, angleOfCursor(state, nextCursor)),
      })
    }
    case 'INSPECT_OK':
    case 'INSPECT_FAIL': {
      if (state.phase !== 'WAIT_RESULT' || !state.request) return same(state)
      if (event.type === 'INSPECT_FAIL') return toError(state, event.error, 'WAIT_RESULT', event.now)
      const result = parseInspectionResult(event.result, state.request.client_request_id)
      if (!result) {
        return toError(
          state,
          invalidResponse('inspect', 'ผลตรวจไม่ตรง contract หรือไม่ใช่ของคำขอนี้ (client_request_id ไม่ตรง)'),
          'WAIT_RESULT',
          event.now,
        )
      }
      const route = routeFor(result.result)
      return same({ ...state, phase: 'SORT', result, route, motion: toDivertMotion(route) })
    }
  }
}

function finishOrient(state: MachineState, orient: OrientProgress, status: SearchStatus): Transition {
  const job = state.job
  if (!job) return same(state)
  const plan = planInspection(job, status, orient.tried, orient.found_view_index)
  const request = buildInspectionRequest(job, plan)
  const primaryAngle = job.views[plan.primary_view_index]?.angle_deg ?? state.angle_deg
  // Turn back to the photo that will actually be sent, so the model shows the angle used.
  const motion = primaryAngle !== state.angle_deg ? rotateMotion(state.angle_deg, primaryAngle) : settleMotion()
  return same({
    ...state,
    phase: 'SETTLE',
    orient: { ...orient, status, sub: 'rotating' },
    plan,
    request,
    motion,
  })
}

function toError(state: MachineState, error: SimError, from: 'ORIENT' | 'WAIT_RESULT', now: number): Transition {
  return same({ ...state, phase: 'ERROR', error, error_from: { phase: from, since: now }, motion: null })
}

function onRetry(state: MachineState, now: number): Transition {
  if (state.phase !== 'ERROR' || !state.error?.retryable || !state.error_from) return same(state)
  const from = state.error_from
  const base: MachineState = { ...state, error: null, error_from: null }
  if (from.phase === 'ORIENT' && state.orient) {
    const orient = { ...state.orient, excluded_ms: state.orient.excluded_ms + Math.max(0, now - from.since) }
    // Same photo, same angle: a failed call never skips an angle.
    return issueLocate({ ...base, phase: 'ORIENT', orient })
  }
  if (from.phase === 'WAIT_RESULT' && state.request) {
    // Identical frozen payload and client_request_id; the backend dedupes it.
    return {
      state: { ...base, phase: 'WAIT_RESULT' },
      effects: [{ type: 'INSPECT', token: state.token, request: state.request }],
    }
  }
  return same(state)
}

function onReplay(state: MachineState): Transition {
  if (state.phase !== 'COMPLETE' || state.paused || !state.result || !state.route) return same(state)
  return same({ ...state, phase: 'SORT', replaying: true, motion: toDivertMotion(state.route) })
}

function invalidResponse(source: 'locate' | 'inspect', message: string): SimError {
  return { source, kind: 'invalid_response', status: null, code: 'invalid_response', message, request_id: null, retryable: false }
}

const VERDICTS: readonly string[] = ['PASS', 'FAIL', 'REVIEW']

/** Minimal guard: correct request, known verdict and a reason allowed for that verdict. */
export function parseInspectionResult(value: unknown, clientRequestId: string): InspectionResult | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.inspection_id !== 'string' || v.inspection_id === '') return null
  if (v.client_request_id !== clientRequestId) return null
  if (typeof v.result !== 'string' || !VERDICTS.includes(v.result)) return null
  const allowed: readonly string[] = REASONS_BY_RESULT[v.result as InspectionVerdict]
  if (typeof v.reason !== 'string' || !allowed.includes(v.reason)) return null
  return value as InspectionResult
}
