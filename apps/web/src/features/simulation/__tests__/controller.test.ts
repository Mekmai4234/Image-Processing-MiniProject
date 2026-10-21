import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockInspectionPort, type MockScenario } from '../api/mockPort'
import { machineConfigFrom } from '../controller/config'
import { SimulationController, type CompletedEvent } from '../controller/SimulationController'
import type { Phase } from '../machine/types'
import { multiJob, singleJob } from './helpers'

let ids = 0
function setup(scenario: Partial<MockScenario> = {}, timeouts: { locate?: number; inspect?: number } = {}) {
  const port = new MockInspectionPort({ locate_delay_ms: 200, inspect_delay_ms: 500, ...scenario })
  const controller = new SimulationController({
    port,
    config: machineConfigFrom(),
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    locate_timeout_ms: timeouts.locate ?? 15_000,
    inspect_timeout_ms: timeouts.inspect ?? 30_000,
  })
  const completed: CompletedEvent[] = []
  const replayed: CompletedEvent[] = []
  controller.onCompleted((e) => completed.push(e))
  controller.onReplayed((e) => replayed.push(e))
  return { port, controller, completed, replayed }
}

/** Advances wall-clock and simulation together in 50 ms frames. */
async function run(controller: SimulationController, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    controller.tick(0.05)
    await vi.advanceTimersByTimeAsync(50)
  }
}

async function runUntil(controller: SimulationController, phase: Phase, maxMs = 60_000) {
  for (let t = 0; t < maxMs && controller.getState().phase !== phase; t += 50) {
    controller.tick(0.05)
    await vi.advanceTimersByTimeAsync(50)
  }
  expect(controller.getState().phase).toBe(phase)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationController with the DEMO mock', () => {
  it('PASS run emits completed exactly once; replay does not count', async () => {
    const { controller, completed, replayed, port } = setup({ verdict: 'PASS' })
    expect(controller.start(singleJob())).toEqual([])
    await runUntil(controller, 'COMPLETE')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.route).toBe('pass')
    expect(completed[0]?.result.demo).toBe(true)
    controller.replay()
    await runUntil(controller, 'COMPLETE')
    controller.replay()
    await runUntil(controller, 'COMPLETE')
    expect(completed).toHaveLength(1)
    expect(replayed).toHaveLength(2)
    expect(port.calls.inspect).toHaveLength(1)
  })

  it('slow API keeps the bottle at the camera until the answer arrives', async () => {
    const { controller } = setup({ inspect_delay_ms: 20_000 })
    controller.start(singleJob())
    await runUntil(controller, 'WAIT_RESULT')
    await run(controller, 15_000)
    expect(controller.getState().phase).toBe('WAIT_RESULT')
    expect(controller.getSnapshot().current_station).toBe('inspect_camera')
    await runUntil(controller, 'SORT', 10_000)
  })

  it('start spam creates one job and one request', async () => {
    const { controller, port, completed } = setup()
    for (let i = 0; i < 10; i++) controller.start(singleJob())
    await runUntil(controller, 'COMPLETE')
    expect(port.calls.inspect).toHaveLength(1)
    expect(completed).toHaveLength(1)
  })

  it('reset mid-request aborts it, and the late result never reaches the next bottle', async () => {
    const { controller, port, completed } = setup({ verdict: 'FAIL_WRONG_LABEL', inspect_delay_ms: 3000 })
    controller.start(singleJob())
    await runUntil(controller, 'WAIT_RESULT')
    expect(controller.inflightCount()).toBe(1)
    controller.reset()
    expect(controller.inflightCount()).toBe(0)
    expect(controller.getState().phase).toBe('IDLE')

    port.setScenario({ verdict: 'PASS', inspect_delay_ms: 500 })
    controller.start(singleJob())
    await runUntil(controller, 'COMPLETE')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.route).toBe('pass')
    // Two separate jobs → two different client_request_ids.
    expect(port.calls.inspect[0]?.client_request_id).not.toBe(port.calls.inspect[1]?.client_request_id)
  })

  it('pausing while a locate is in flight does not issue more requests', async () => {
    const { controller, port } = setup({ usable_at_attempt: 3, locate_delay_ms: 1000 })
    port.resetLocateCounter()
    controller.start(multiJob())
    await runUntil(controller, 'ORIENT')
    await run(controller, 600) // rotation done, first locate in flight
    expect(port.calls.locate).toHaveLength(1)
    controller.pause()
    await run(controller, 5000) // response arrives during pause and is buffered
    expect(port.calls.locate).toHaveLength(1)
    expect(controller.getSnapshot().has_buffered_response).toBe(true)
    expect(controller.getSnapshot().state).toBe('PAUSED')
    controller.resume()
    await runUntil(controller, 'COMPLETE')
    expect(port.calls.locate).toHaveLength(3)
    expect(port.calls.inspect).toHaveLength(1)
  })

  it('network timeout is an ERROR; retry reuses client_request_id and the backend dedupes', async () => {
    const { controller, port, completed } = setup({ inspect_failures_before_success: 1 })
    controller.start(singleJob())
    await runUntil(controller, 'ERROR')
    const snapshot = controller.getSnapshot()
    expect(snapshot.error?.status).toBe(503)
    expect(snapshot.result).toBeNull()
    controller.retry()
    await runUntil(controller, 'COMPLETE')
    expect(port.calls.inspect).toHaveLength(2)
    expect(port.calls.inspect[0]?.client_request_id).toBe(port.calls.inspect[1]?.client_request_id)
    expect(port.calls.inspect[0]).toBe(port.calls.inspect[1])
    expect(completed).toHaveLength(1)
  })

  it('hung API hits the real-time timeout regardless of simulation speed', async () => {
    const { controller } = setup({ verdict: 'HANG' }, { inspect: 4000 })
    controller.setSpeed(3)
    controller.start(singleJob())
    await runUntil(controller, 'WAIT_RESULT')
    await run(controller, 3500)
    expect(controller.getState().phase).toBe('WAIT_RESULT')
    await runUntil(controller, 'ERROR', 1000)
    expect(controller.getSnapshot().error?.kind).toBe('timeout')
    expect(controller.getSnapshot().error?.retryable).toBe(true)
  })

  it('every-angle-hidden set ends REVIEW orientation_failed without looping', async () => {
    const { controller, port, completed } = setup({ usable_at_attempt: null })
    port.resetLocateCounter()
    controller.start(multiJob([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]))
    await runUntil(controller, 'COMPLETE', 120_000)
    expect(port.calls.locate).toHaveLength(12)
    expect(port.calls.inspect).toHaveLength(1)
    expect(port.calls.inspect[0]?.supporting_images).toHaveLength(11)
    expect(completed[0]?.result.reason).toBe('orientation_failed')
    expect(completed[0]?.route).toBe('review')
  })

  it('destroy aborts requests and silences listeners', async () => {
    const { controller, completed } = setup({ inspect_delay_ms: 2000 })
    const snapshots: unknown[] = []
    controller.onSnapshot((s) => snapshots.push(s))
    controller.start(singleJob())
    await runUntil(controller, 'WAIT_RESULT')
    controller.destroy()
    const count = snapshots.length
    expect(controller.inflightCount()).toBe(0)
    await run(controller, 5000)
    controller.start(singleJob())
    expect(snapshots.length).toBe(count)
    expect(completed).toHaveLength(0)
  })

  it('snapshot listeners fire on meaningful changes only, not every frame', async () => {
    const { controller } = setup()
    const states: string[] = []
    controller.onSnapshot((s) => states.push(s.state))
    controller.start(singleJob())
    await runUntil(controller, 'COMPLETE')
    expect(states.length).toBeLessThan(20)
    expect(states[0]).toBe('FEED')
    expect(states.at(-1)).toBe('COMPLETE')
  })
})
