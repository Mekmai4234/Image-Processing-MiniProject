import type { InspectionResult, LocateLabelResponse } from '../api/contract'
import { machineConfigFrom } from '../controller/config'
import { transition } from '../machine/machine'
import type { Effect, JobInput, MachineConfig, MachineEvent, MachineState, Phase } from '../machine/types'

export const config: MachineConfig = machineConfigFrom(undefined, { orient_budget_ms: 60_000 })

export function blob(label = 'img'): Blob {
  return new Blob([label], { type: 'image/jpeg' })
}

export function singleJob(): JobInput {
  return { expected_product: 'bottle_a', views: [{ angle_deg: 0, image: blob('a0') }] }
}

export function multiJob(angles = [0, 90, 180, 270]): JobInput {
  return { expected_product: 'bottle_a', views: angles.map((a) => ({ angle_deg: a, image: blob(`a${a}`) })) }
}

/** Applies events in order, collecting every effect. */
export class Driver {
  state: MachineState
  effects: Effect[] = []
  now = 0

  constructor(state: MachineState, readonly cfg: MachineConfig = config) {
    this.state = state
  }

  send(event: MachineEvent): Effect[] {
    const { state, effects } = transition(this.state, event, this.cfg)
    this.state = state
    this.effects.push(...effects)
    return effects
  }

  start(job: JobInput, ids = { job: 'job-1', req: 'req-1' }): Effect[] {
    return this.send({ type: 'START', job, job_id: ids.job, client_request_id: ids.req, now: this.now })
  }

  /** Ticks in 50 ms steps until the phase changes or `maxSeconds` of sim time pass. */
  tickUntilPhaseChange(maxSeconds = 30): Effect[] {
    const start = this.state.phase
    const collected: Effect[] = []
    for (let t = 0; t < maxSeconds && this.state.phase === start; t += 0.05) {
      this.now += 50
      collected.push(...this.send({ type: 'TICK', dt: 0.05, now: this.now }))
    }
    return collected
  }

  /** Ticks until a new LOCATE effect is issued (ORIENT stays the same phase meanwhile). */
  tickUntilLocate(maxSeconds = 10): Effect[] {
    const before = this.count('LOCATE')
    const collected: Effect[] = []
    for (let t = 0; t < maxSeconds && this.count('LOCATE') === before; t += 0.05) {
      this.now += 50
      collected.push(...this.send({ type: 'TICK', dt: 0.05, now: this.now }))
    }
    return collected
  }

  /** Ticks until `phase` is reached (or throws). */
  tickTo(phase: Phase, maxSteps = 20): Effect[] {
    const collected: Effect[] = []
    for (let i = 0; i < maxSteps && this.state.phase !== phase; i++) {
      const before = this.state
      collected.push(...this.tickUntilPhaseChange())
      if (this.state === before) break
      // ORIENT can wait on a locate response; stop there.
      if (this.state.phase === 'ORIENT' && this.state.orient?.sub === 'locating') break
    }
    if (this.state.phase !== phase) throw new Error(`expected ${phase}, got ${this.state.phase}`)
    return collected
  }

  /** Ticks for a while without expecting progress. */
  idle(seconds: number): void {
    for (let t = 0; t < seconds; t += 0.05) {
      this.now += 50
      this.send({ type: 'TICK', dt: 0.05, now: this.now })
    }
  }

  lastEffect<T extends Effect['type']>(type: T): Extract<Effect, { type: T }> | undefined {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      if (e && e.type === type) return e as Extract<Effect, { type: T }>
    }
    return undefined
  }

  count(type: Effect['type']): number {
    return this.effects.filter((e) => e.type === type).length
  }
}

export function locate(usable: boolean, overrides: Partial<LocateLabelResponse['quality']> = {}): LocateLabelResponse {
  return {
    usable_view: usable,
    bbox: usable ? { x: 1, y: 1, width: 10, height: 10 } : null,
    image_width: 400,
    image_height: 500,
    quality: { sharp_enough: true, label_visible: usable, bottle_visible: true, ...overrides },
    reason: usable ? 'usable_view' : 'label_not_visible',
  }
}

export function result(
  clientRequestId: string,
  verdict: InspectionResult['result'] = 'PASS',
  reason: InspectionResult['reason'] = 'good',
  id = '00000000-0000-4000-8000-000000000001',
): InspectionResult {
  return {
    inspection_id: id,
    client_request_id: clientRequestId,
    created_at: '2026-10-19T00:00:00Z',
    source_mode: 'simulation',
    expected_product: 'bottle_a',
    detected_product: verdict === 'PASS' ? 'bottle_a' : null,
    result: verdict,
    reason,
    match_score: verdict === 'PASS' ? 0.9 : null,
    score_method: verdict === 'PASS' ? 'template_ccoeff_normed_clamped_v1' : null,
    bbox: null,
    expected_bbox: null,
    image_width: 400,
    image_height: 500,
    orientation_deg: 0,
    timing_ms: { orientation: 0, inspection: 1, storage: 1, total: 2 },
    config_version: 'demo-v0',
    storage_status: 'saved',
    storage_error: null,
    images: { original: null, annotated: null },
    evidence: {
      kind: 'single_view',
      search_status: 'not_requested',
      supporting_angles_deg: [],
      reported_coverage_deg: null,
      verified_coverage: false,
      required_view_profile: null,
      supporting_images: [],
    },
    reviewed_result: null,
    reviewed_reason: null,
    reviewer: null,
    reviewed_at: null,
    demo: true,
  }
}
