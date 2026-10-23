import { describe, expect, it } from 'vitest'
import { initialState, displayState } from '../machine/machine'
import { poseOf, LAYOUT } from '../machine/motion'
import type { SimError } from '../machine/types'
import { Driver, blob, config, locate, multiJob, result, singleJob } from './helpers'

const err503: SimError = {
  source: 'inspect',
  kind: 'http',
  status: 503,
  code: 'inspection_unavailable',
  message: '503',
  request_id: 'r1',
  retryable: true,
}
const err422: SimError = { ...err503, status: 422, code: 'invalid_image', retryable: false }

function toWaitResult(d: Driver) {
  d.start(singleJob())
  d.tickTo('WAIT_RESULT')
}

describe('single view', () => {
  it('automatically rotates 360 degrees before inspecting one real photo without inventing views', () => {
    const d = new Driver(initialState())
    d.start(singleJob())
    expect(d.state.phase).toBe('FEED')
    d.tickTo('ORIENT')
    expect(d.state.motion?.kind).toBe('rotate')
    expect(d.state.motion?.to_deg).toBe(360)
    d.tickTo('SETTLE')
    d.tickTo('INSPECT')
    d.tickTo('WAIT_RESULT')
    expect(d.count('LOCATE')).toBe(0)
    const inspect = d.lastEffect('INSPECT')
    expect(inspect?.request.evidence).toEqual({
      kind: 'single_view',
      search_status: 'not_requested',
      supporting_angles_deg: [],
      reported_coverage_deg: null,
    })
    expect(inspect?.request.supporting_images).toHaveLength(0)
    expect(inspect?.request.source_mode).toBe('simulation')
    expect(inspect?.request.client_request_id).toBe('req-1')
    expect(inspect?.request.angle_deg).toBe(0)
  })

  it('omits angle_deg when the single photo angle is unknown', () => {
    const d = new Driver(initialState())
    d.start({ expected_product: 'bottle_a', views: [{ angle_deg: null, image: blob() }] })
    d.tickTo('WAIT_RESULT')
    expect('angle_deg' in (d.lastEffect('INSPECT')?.request ?? {})).toBe(false)
  })

  it('never leaves WAIT_RESULT on time alone', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.idle(600)
    expect(d.state.phase).toBe('WAIT_RESULT')
    expect(d.count('INSPECT')).toBe(1)
    expect(poseOf(d.state).x).toBe(LAYOUT.inspect_x)
  })

  it.each([
    ['PASS', 'good', 'pass'],
    ['FAIL', 'wrong_label', 'reject'],
    ['REVIEW', 'blurred_image', 'review'],
  ] as const)('%s routes to %s and completes once', (verdict, reason, route) => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-1', verdict, reason), now: d.now })
    expect(d.state.phase).toBe('SORT')
    expect(d.state.route).toBe(route)
    d.tickTo('OUTPUT')
    d.tickTo('COMPLETE')
    expect(d.count('COMPLETED')).toBe(1)
    expect(d.lastEffect('COMPLETED')?.route).toBe(route)
    d.idle(5)
    expect(d.count('COMPLETED')).toBe(1)
  })
})

describe('multi view ORIENT', () => {
  it('locates one real angle at a time in ascending order and stops at the usable one', () => {
    const d = new Driver(initialState())
    d.start(multiJob([180, 0, 90, 270]))
    d.tickTo('ORIENT')
    d.tickUntilLocate() // rotate to first angle → LOCATE
    expect(d.count('LOCATE')).toBe(1)
    const first = d.lastEffect('LOCATE')
    expect(d.state.job?.views[first?.view_index ?? -1]?.angle_deg).toBe(0)
    // Only one in flight: more ticks do not fire another locate.
    d.idle(5)
    expect(d.count('LOCATE')).toBe(1)

    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: first?.attempt ?? 0, response: locate(false), now: d.now })
    d.tickUntilLocate()
    const second = d.lastEffect('LOCATE')
    expect(d.state.job?.views[second?.view_index ?? -1]?.angle_deg).toBe(90)

    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: second?.attempt ?? 0, response: locate(true), now: d.now })
    expect(d.state.phase).toBe('SETTLE')
    expect(d.state.orient?.status).toBe('usable_view_found')
    d.tickTo('WAIT_RESULT')
    const req = d.lastEffect('INSPECT')?.request
    expect(req?.angle_deg).toBe(90)
    expect(req?.supporting_images).toHaveLength(0)
    expect(req?.evidence).toEqual({
      kind: 'single_view',
      search_status: 'usable_view_found',
      supporting_angles_deg: [],
      reported_coverage_deg: null,
    })
    expect(d.count('LOCATE')).toBe(2)
  })

  it('ignores a locate response for an older attempt', () => {
    const d = new Driver(initialState())
    d.start(multiJob())
    d.tickTo('ORIENT')
    d.tickUntilLocate()
    const attempt = d.lastEffect('LOCATE')?.attempt ?? 0
    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: attempt - 1, response: locate(true), now: d.now })
    expect(d.state.orient?.status).toBeNull()
    expect(d.state.phase).toBe('ORIENT')
  })

  it('exhausts all angles, still sends evidence, and ends REVIEW via the backend', () => {
    const d = new Driver(initialState())
    d.start(multiJob([0, 90, 180, 270]))
    d.tickTo('ORIENT')
    for (let i = 0; i < 4; i++) {
      d.tickUntilLocate()
      const loc = d.lastEffect('LOCATE')
      // 180° is blurry → lower quality; 0° remains the representative by tie-break
      const response = locate(false, loc?.view_index === 2 ? { sharp_enough: false } : {})
      d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response, now: d.now })
    }
    expect(d.count('LOCATE')).toBe(4)
    expect(d.state.phase).toBe('SETTLE')
    expect(d.state.orient?.status).toBe('exhausted')
    d.tickTo('WAIT_RESULT')
    const req = d.lastEffect('INSPECT')?.request
    expect(req?.angle_deg).toBe(0)
    expect(req?.supporting_images).toHaveLength(3)
    expect(req?.evidence).toEqual({
      kind: 'multi_view',
      search_status: 'exhausted',
      supporting_angles_deg: [90, 180, 270],
      reported_coverage_deg: 360,
    })
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-1', 'REVIEW', 'orientation_failed'), now: d.now })
    expect(d.state.route).toBe('review')
  })

  it('returns the model to the representative angle before capture', () => {
    const d = new Driver(initialState())
    d.start(multiJob([0, 90]))
    d.tickTo('ORIENT')
    for (let i = 0; i < 2; i++) {
      d.tickUntilLocate()
      const loc = d.lastEffect('LOCATE')
      const response = locate(false, loc?.view_index === 0 ? { bottle_visible: false } : {})
      d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response, now: d.now })
    }
    expect(d.state.plan?.primary_view_index).toBe(1)
    d.tickTo('INSPECT')
    expect(d.state.angle_deg).toBe(90)
  })

  it('times out on the real-time budget, excluding paused time', () => {
    const d = new Driver(initialState(), { ...config, orient_budget_ms: 1000 })
    d.start(multiJob([0, 30, 60, 90]))
    d.tickTo('ORIENT')
    d.tickUntilLocate()
    let loc = d.lastEffect('LOCATE')
    // Pause for 10 s of real time: must not count against the budget.
    d.send({ type: 'PAUSE', now: d.now })
    d.now += 10_000
    d.send({ type: 'RESUME', now: d.now })
    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response: locate(false), now: d.now })
    expect(d.state.phase).toBe('ORIENT')
    d.tickUntilLocate()
    loc = d.lastEffect('LOCATE')
    d.now += 2000 // slow locator pushes past the budget
    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response: locate(false), now: d.now })
    expect(d.state.orient?.status).toBe('timed_out')
    d.tickTo('WAIT_RESULT')
    const ev = d.lastEffect('INSPECT')?.request.evidence
    expect(ev?.search_status).toBe('timed_out')
    expect(ev?.supporting_angles_deg).toEqual([30])
    expect(ev?.reported_coverage_deg).toBe(60)
  })

  it('skips photos beyond max_rotation_deg instead of inventing angles', () => {
    const d = new Driver(initialState(), { ...config, max_rotation_deg: 180 })
    d.start(multiJob([0, 90, 180, 270]))
    expect(d.state.job?.search_order.map((i) => d.state.job?.views[i]?.angle_deg)).toEqual([0, 90, 180])
    expect(d.state.job?.skipped_views).toEqual([3])
  })

  it('locate error goes to ERROR; retry asks about the same photo again', () => {
    const d = new Driver(initialState())
    d.start(multiJob())
    d.tickTo('ORIENT')
    d.tickUntilLocate()
    const loc = d.lastEffect('LOCATE')
    d.send({ type: 'LOCATE_FAIL', token: d.state.token, attempt: loc?.attempt ?? 0, error: { ...err503, source: 'locate' }, now: d.now })
    expect(d.state.phase).toBe('ERROR')
    d.send({ type: 'RETRY', now: d.now })
    expect(d.state.phase).toBe('ORIENT')
    const again = d.lastEffect('LOCATE')
    expect(again?.view_index).toBe(loc?.view_index)
    expect(again?.attempt).toBe((loc?.attempt ?? 0) + 1)
  })
})

describe('pause, reset, retry, replay', () => {
  it('buffers a result that arrives while paused and applies it only on resume', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'PAUSE', now: d.now })
    expect(displayState(d.state)).toBe('PAUSED')
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-1'), now: d.now })
    d.idle(5)
    expect(d.state.phase).toBe('WAIT_RESULT')
    d.send({ type: 'RESUME', now: d.now })
    expect(d.state.phase).toBe('SORT')
    expect(d.count('INSPECT')).toBe(1)
  })

  it('does not fire the next locate while paused mid-rotation', () => {
    const d = new Driver(initialState())
    d.start(multiJob())
    d.tickTo('ORIENT')
    d.send({ type: 'PAUSE', now: d.now })
    d.idle(10)
    expect(d.count('LOCATE')).toBe(0)
    d.send({ type: 'RESUME', now: d.now })
    d.tickUntilLocate()
    expect(d.count('LOCATE')).toBe(1)
  })

  it('freezes the pusher mid-stroke on pause', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-1', 'FAIL', 'wrong_label'), now: d.now })
    d.tickTo('OUTPUT')
    d.idle(0.3)
    d.send({ type: 'PAUSE', now: d.now })
    const frozen = poseOf(d.state)
    d.idle(5)
    expect(poseOf(d.state)).toEqual(frozen)
    expect(frozen.reject_pusher).toBeGreaterThan(0)
    expect(frozen.review_pusher).toBe(0)
  })

  it('drops results from a job abandoned by reset', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    const oldToken = d.state.token
    expect(d.send({ type: 'RESET' })).toEqual([{ type: 'ABORT_REQUESTS' }])
    expect(d.state.phase).toBe('IDLE')
    d.start(singleJob(), { job: 'job-2', req: 'req-2' })
    d.tickTo('WAIT_RESULT')
    d.send({ type: 'INSPECT_OK', token: oldToken, result: result('req-1', 'FAIL', 'wrong_label'), now: d.now })
    expect(d.state.phase).toBe('WAIT_RESULT')
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-2'), now: d.now })
    expect(d.state.route).toBe('pass')
  })

  it('rejects a result whose client_request_id is not this job', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('someone-else'), now: d.now })
    expect(d.state.phase).toBe('ERROR')
    expect(d.state.error?.code).toBe('invalid_response')
    expect(d.state.error?.retryable).toBe(false)
  })

  it('API error is ERROR (never FAIL); retry resends the identical frozen payload', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    const first = d.lastEffect('INSPECT')?.request
    d.send({ type: 'INSPECT_FAIL', token: d.state.token, error: err503, now: d.now })
    expect(d.state.phase).toBe('ERROR')
    expect(d.state.result).toBeNull()
    expect(d.state.route).toBeNull()
    d.send({ type: 'RETRY', now: d.now })
    expect(d.state.phase).toBe('WAIT_RESULT')
    expect(d.lastEffect('INSPECT')?.request).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('non-retryable errors need a reset', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'INSPECT_FAIL', token: d.state.token, error: err422, now: d.now })
    d.send({ type: 'RETRY', now: d.now })
    expect(d.state.phase).toBe('ERROR')
    expect(d.count('INSPECT')).toBe(1)
  })

  it('replay re-animates without a request or a COMPLETED effect', () => {
    const d = new Driver(initialState())
    toWaitResult(d)
    d.send({ type: 'INSPECT_OK', token: d.state.token, result: result('req-1'), now: d.now })
    d.tickTo('COMPLETE')
    d.send({ type: 'REPLAY' })
    expect(d.state.phase).toBe('SORT')
    d.tickTo('COMPLETE')
    expect(d.count('COMPLETED')).toBe(1)
    expect(d.count('REPLAYED')).toBe(1)
    expect(d.count('INSPECT')).toBe(1)
  })

  it('ignores START while a job is running and when input is invalid', () => {
    const d = new Driver(initialState())
    d.start(singleJob())
    const token = d.state.token
    d.start(singleJob(), { job: 'job-x', req: 'req-x' })
    expect(d.state.token).toBe(token)
    expect(d.state.job?.job_id).toBe('job-1')

    const idle = new Driver(initialState())
    idle.start({ expected_product: 'bottle_a', views: [] })
    expect(idle.state.phase).toBe('IDLE')
  })

  it('cannot pause in IDLE, COMPLETE or ERROR', () => {
    const d = new Driver(initialState())
    d.send({ type: 'PAUSE', now: 0 })
    expect(d.state.paused).toBeNull()
  })
})

describe('stations along the line', () => {
  it('orients on the turntable, then carries the chosen angle to the inspection enclosure', () => {
    const d = new Driver(initialState())
    d.start(multiJob([0, 90]))
    d.tickTo('ORIENT')
    expect(poseOf(d.state).station).toBe('turntable')
    d.tickUntilLocate()
    let loc = d.lastEffect('LOCATE')
    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response: locate(false), now: d.now })
    d.tickUntilLocate()
    loc = d.lastEffect('LOCATE')
    d.send({ type: 'LOCATE_OK', token: d.state.token, attempt: loc?.attempt ?? 0, response: locate(true), now: d.now })
    expect(d.state.phase).toBe('SETTLE')
    expect(d.state.motion?.kind).toBe('to_inspect')
    const xs: number[] = []
    while (d.state.phase === 'SETTLE') {
      d.idle(0.05)
      xs.push(poseOf(d.state).x)
      expect(d.state.angle_deg).toBe(90)
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(LAYOUT.turntable_x)
    expect(xs.at(-1)).toBe(LAYOUT.inspect_x)
    expect(poseOf(d.state).station).toBe('inspect')
  })

  it('a locate error waits on the turntable; an inspect error waits in the enclosure', () => {
    const a = new Driver(initialState())
    a.start(multiJob())
    a.tickTo('ORIENT')
    a.tickUntilLocate()
    const loc = a.lastEffect('LOCATE')
    a.send({ type: 'LOCATE_FAIL', token: a.state.token, attempt: loc?.attempt ?? 0, error: { ...err503, source: 'locate' }, now: a.now })
    expect(poseOf(a.state).station).toBe('turntable')

    const b = new Driver(initialState())
    toWaitResult(b)
    b.send({ type: 'INSPECT_FAIL', token: b.state.token, error: err503, now: b.now })
    expect(poseOf(b.state).station).toBe('inspect')
  })

  it('single photo skips the search but still travels to the inspection camera', () => {
    const d = new Driver(initialState())
    d.start(singleJob())
    d.tickTo('SETTLE')
    expect(d.state.motion?.kind).toBe('to_inspect')
    expect(d.count('LOCATE')).toBe(0)
    d.tickTo('INSPECT')
    expect(poseOf(d.state).x).toBe(LAYOUT.inspect_x)
  })
})
