import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoDataSource, type DemoScenario } from '../../../demo/demoDataSource'
import { ApiError as SharedApiError } from '../../../lib/api'
import type { DataSource } from '../../../lib/dataSource'
import { createDataSourcePort, toPortError } from '../api/dataSourcePort'
import { machineConfigFrom } from '../controller/config'
import { SimulationController, type CompletedEvent } from '../controller/SimulationController'
import { toJobInput } from '../jobInput'
import type { Phase } from '../machine/types'
import { blob } from './helpers'

let ids = 0
function setup(scenario: DemoScenario) {
  let current = scenario
  const ds = createDemoDataSource(() => current)
  const port = createDataSourcePort(ds)
  const controller = new SimulationController({
    port,
    config: machineConfigFrom(),
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  })
  const completed: CompletedEvent[] = []
  controller.onCompleted((e) => completed.push(e))
  return { ds, port, controller, completed, setScenario: (s: DemoScenario) => (current = s) }
}

async function runUntil(controller: SimulationController, phase: Phase, maxMs = 60_000) {
  for (let t = 0; t < maxMs && controller.getState().phase !== phase; t += 50) {
    controller.tick(0.05)
    await vi.advanceTimersByTimeAsync(50)
  }
  expect(controller.getState().phase).toBe(phase)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createDataSourcePort over the DEMO DataSource', () => {
  it('marks the port as DEMO and reads simulation_defaults from the catalog', async () => {
    const { port } = setup('pass')
    expect(port.demo).toBe(true)
    const catalog = await port.getProducts()
    expect(catalog.simulation_defaults).toEqual({ max_rotation_deg: 360, rotation_step_deg: 30 })
  })

  it('PASS: one inspection recorded in the shared store and counted once', async () => {
    const { ds, controller, completed } = setup('pass')
    controller.start(toJobInput('bottle_a', [0, 90, 180, 270].map((a) => ({ blob: blob(`v${a}`), angle: a, name: `v${a}.jpg` }))))
    await runUntil(controller, 'COMPLETE')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.route).toBe('pass')
    const page = await (async () => {
      const p = ds.listInspections({ page: 1, page_size: 20 })
      await vi.advanceTimersByTimeAsync(400)
      return p
    })()
    const mine = page.items.filter((r) => r.inspection_id === completed[0]?.inspection_id)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.source_mode).toBe('simulation')
  })

  it('every angle hidden → search exhausted → REVIEW lane', async () => {
    const { controller, completed } = setup('orientation_failed')
    controller.start(toJobInput('bottle_a', [0, 90, 180, 270].map((a) => ({ blob: blob(`v${a}`), angle: a }))))
    await runUntil(controller, 'COMPLETE')
    const state = controller.getState()
    expect(state.orient?.status).toBe('exhausted')
    expect(state.request?.supporting_images).toHaveLength(3)
    expect(completed[0]?.route).toBe('review')
  })

  it('API 503 is an ERROR with retry; retry reuses the request and then completes', async () => {
    const { controller, completed, setScenario } = setup('api_error')
    controller.start(toJobInput('bottle_a', [{ blob: blob(), angle: 0 }]))
    await runUntil(controller, 'ERROR')
    const snap = controller.getSnapshot()
    expect(snap.error?.status).toBe(503)
    expect(snap.error?.retryable).toBe(true)
    expect(snap.result).toBeNull()
    const firstRequest = controller.getState().request
    setScenario('pass')
    controller.retry()
    await runUntil(controller, 'COMPLETE')
    expect(controller.getState().request).toBe(firstRequest)
    expect(completed).toHaveLength(1)
  })

  it('storage failure keeps the verdict and routes by it', async () => {
    const { controller, completed } = setup('save_failed')
    controller.start(toJobInput('bottle_a', [{ blob: blob(), angle: null }]))
    await runUntil(controller, 'COMPLETE')
    expect(completed[0]?.result.storage_status).toBe('failed')
    expect(completed[0]?.route).toBe('pass')
  })
})

describe('toPortError', () => {
  it('maps shared client errors without turning them into verdicts', () => {
    const e = toPortError(new SharedApiError('http', 'bad', { status: 422, code: 'invalid_image', requestId: 'r' }))
    expect([e.kind, e.status, e.code, e.requestId, e.retryable]).toEqual(['http', 422, 'invalid_image', 'r', false])
    expect(toPortError(new SharedApiError('network', 'down')).retryable).toBe(true)
    expect(toPortError(new SharedApiError('aborted', 'x')).kind).toBe('aborted')
    expect(toPortError(new DOMException('x', 'AbortError')).kind).toBe('aborted')
  })

  it('passes live DataSource calls straight through', async () => {
    const calls: string[] = []
    const fake = {
      kind: 'live',
      products: async () => {
        calls.push('products')
        return { products: [] }
      },
      locateLabel: async (_b: Blob, expected: string) => {
        calls.push(`locate:${expected}`)
        throw new SharedApiError('http', 'unavailable', { status: 503 })
      },
    } as unknown as DataSource
    const port = createDataSourcePort(fake)
    expect(port.demo).toBe(false)
    await port.getProducts()
    await expect(port.locateLabel({ image: blob(), expected_product: 'bottle_b' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'http',
      status: 503,
      retryable: true,
    })
    expect(calls).toEqual(['products', 'locate:bottle_b'])
  })
})

describe('toJobInput', () => {
  it('keeps order, angles and file names; never guesses an angle', () => {
    const file = new File(['x'], 'front.png', { type: 'image/png' })
    const job = toJobInput('bottle_a', [
      { blob: file, angle: null },
      { blob: blob(), angle: 90, name: 'side.jpg' },
    ])
    expect(job.views.map((v) => [v.angle_deg, v.name])).toEqual([
      [null, 'front.png'],
      [90, 'side.jpg'],
    ])
  })
})

describe('snapshot for the captured-image panel', () => {
  it('exposes the photo being located, then the exact photo sent with the result', async () => {
    const { controller, completed } = setup('pass')
    const views = [0, 90].map((a) => ({ blob: blob(`v${a}`), angle: a }))
    controller.start(toJobInput('bottle_a', views))
    expect(controller.getSnapshot().captured_image).toBeNull()
    await runUntil(controller, 'ORIENT')
    for (let i = 0; i < 40 && controller.getState().orient?.sub !== 'locating'; i++) {
      controller.tick(0.05)
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(controller.getSnapshot().current_image).toBe(views[0]!.blob)
    await runUntil(controller, 'WAIT_RESULT')
    const waiting = controller.getSnapshot()
    expect(waiting.current_image).toBeNull()
    expect(waiting.captured_image).toBe(views[0]!.blob)
    expect(waiting.captured_angle_deg).toBe(0)
    await runUntil(controller, 'COMPLETE')
    const done = controller.getSnapshot()
    expect(done.captured_image).toBe(controller.getState().request?.image)
    expect(done.result?.inspection_id).toBe(completed[0]?.inspection_id)
    expect(done.result?.image_width).toBeGreaterThan(0)
  })
})
