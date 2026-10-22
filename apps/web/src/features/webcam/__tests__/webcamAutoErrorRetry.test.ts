import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebcamCaptureController } from '../captureController'
import type { DataSource } from '../../../lib/dataSource'
import type { InspectionRequest, InspectionResult } from '../../../types/inspection'

describe('Webcam Auto-Capture Post-Error & Idempotent Retry Robustness (17-4 / P2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('criterion 1: network timeout on first request keeps bottle stationary for 5s with only 1 request dispatched', async () => {
    const inspectCalls: InspectionRequest[] = []
    const mockDs = {
      createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
        inspectCalls.push(req)
        throw new Error('504 Gateway Timeout')
      }),
    } as unknown as DataSource

    const controller = new WebcamCaptureController({
      dataSource: mockDs,
      expectedProduct: 'bottle_a',
      autoCaptureEnabled: true,
      isStreaming: true,
    })

    // Bottle enters and is usable
    controller.onLocatorTick(true, true)
    expect(controller.phase).toBe('holding')

    // Advance 800ms to complete dwell and trigger first capture
    await vi.advanceTimersByTimeAsync(800)

    // First request failed -> should transition to error_waiting_retry
    expect(inspectCalls).toHaveLength(1)
    expect(inspectCalls[0]?.client_request_id).toBeDefined()
    expect(controller.phase).toBe('error_waiting_retry')
    expect(controller.failedRequest?.expected_product).toBe('bottle_a')
    expect(controller.error).toBeTruthy()
    expect(controller.canRetry).toBe(true)

    // Simulate bottle held stationary in front of camera for 5 seconds (50 locator ticks at 100ms)
    for (let i = 0; i < 50; i++) {
      controller.onLocatorTick(true, true)
      await vi.advanceTimersByTimeAsync(100)
    }

    // Must strictly have sent only 1 request; no automatic duplicate triggers
    expect(inspectCalls).toHaveLength(1)
    expect(controller.phase).toBe('error_waiting_retry')
    expect(controller.canRetry).toBe(true)
  })

  it('criterion 2 & 3: clicking Retry uses identical client_request_id and payload; succeeds and enters awaiting_removal', async () => {
    const inspectCalls: InspectionRequest[] = []
    let attempts = 0
    const mockDs = {
      createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
        inspectCalls.push(req)
        attempts++
        if (attempts === 1) {
          throw new Error('503 Service Unavailable')
        }
        return {
          inspection_id: 'insp-idemp-01',
          client_request_id: req.client_request_id,
          result: 'PASS',
          expected_product: req.expected_product,
          storage_status: 'saved',
          timing_ms: { total: 12 },
        } as InspectionResult
      }),
    } as unknown as DataSource

    const controller = new WebcamCaptureController({
      dataSource: mockDs,
      expectedProduct: 'bottle_a',
      autoCaptureEnabled: true,
      isStreaming: true,
    })

    // Trigger dwell & first failed capture
    controller.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)

    expect(inspectCalls).toHaveLength(1)
    expect(controller.phase).toBe('error_waiting_retry')
    const originalReqId = inspectCalls[0]?.client_request_id

    // User explicitly clicks Retry
    await controller.triggerRetry()

    // Second call must use identical client_request_id and request fields
    expect(inspectCalls).toHaveLength(2)
    expect(inspectCalls[1]?.client_request_id).toBe(originalReqId)
    expect(inspectCalls[1]?.expected_product).toBe(inspectCalls[0]?.expected_product)
    expect(inspectCalls[1]?.source_mode).toBe(inspectCalls[0]?.source_mode)

    // After success: failedRequest cleared, phase becomes awaiting_removal
    expect(controller.failedRequest).toBeNull()
    expect(controller.canRetry).toBe(false)
    expect(controller.phase).toBe('awaiting_removal')
    expect(controller.result?.inspection_id).toBe('insp-idemp-01')

    // While bottle remains visible, no new capture should trigger
    controller.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inspectCalls).toHaveLength(2)
  })

  it('criterion 3b: repeated retry failure keeps state in error_waiting_retry without auto-generating new IDs', async () => {
    const inspectCalls: InspectionRequest[] = []
    const mockDs = {
      createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
        inspectCalls.push(req)
        throw new Error('500 Internal Server Error')
      }),
    } as unknown as DataSource

    const controller = new WebcamCaptureController({
      dataSource: mockDs,
      expectedProduct: 'bottle_a',
      autoCaptureEnabled: true,
      isStreaming: true,
    })

    // Initial capture fails
    controller.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)
    expect(inspectCalls).toHaveLength(1)
    expect(controller.phase).toBe('error_waiting_retry')

    // First retry fails
    await controller.triggerRetry()
    expect(inspectCalls).toHaveLength(2)
    expect(controller.phase).toBe('error_waiting_retry')

    // Second retry fails
    await controller.triggerRetry()
    expect(inspectCalls).toHaveLength(3)
    expect(controller.phase).toBe('error_waiting_retry')

    // All retries used the same client_request_id
    expect(inspectCalls[1]?.client_request_id).toBe(inspectCalls[0]?.client_request_id)
    expect(inspectCalls[2]?.client_request_id).toBe(inspectCalls[0]?.client_request_id)

    // Ticks with bottle present do not fire new requests
    for (let i = 0; i < 20; i++) {
      controller.onLocatorTick(true, true)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(inspectCalls).toHaveLength(3)
  })

  it('criterion 4: changing product or context during in-flight retry discards stale result', async () => {
    let resolveInspection: (val: InspectionResult) => void = () => {}
    const mockDs = {
      createInspection: vi.fn().mockImplementation(() => {
        return new Promise<InspectionResult>((resolve) => {
          resolveInspection = resolve
        })
      }),
    } as unknown as DataSource

    const controller = new WebcamCaptureController({
      dataSource: mockDs,
      expectedProduct: 'bottle_a',
      autoCaptureEnabled: true,
      isStreaming: true,
    })

    // First capture starts and is pending
    controller.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)
    expect(controller.capturing).toBe(true)

    // User switches product while request is in-flight
    controller.selectProduct('bottle_b')
    expect(controller.phase).toBe('waiting_bottle')
    expect(controller.product).toBe('bottle_b')
    expect(controller.capturing).toBe(false)

    // Later, the old in-flight request resolves
    resolveInspection({
      inspection_id: 'stale-insp-01',
      client_request_id: 'req-stale',
      result: 'PASS',
      expected_product: 'bottle_a',
      storage_status: 'saved',
      timing_ms: { total: 10 },
    } as InspectionResult)

    await vi.advanceTimersByTimeAsync(50)

    // Stale result must be discarded: result remains null
    expect(controller.result).toBeNull()
  })

  it('criterion 5: removing bottle resets error_waiting_retry to waiting_bottle; new bottle generates new ID', async () => {
    const inspectCalls: InspectionRequest[] = []
    let callCount = 0
    const mockDs = {
      createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
        inspectCalls.push(req)
        callCount++
        if (callCount === 1) {
          throw new Error('Network offline')
        }
        return {
          inspection_id: 'insp-bottle-2',
          client_request_id: req.client_request_id,
          result: 'PASS',
          expected_product: req.expected_product,
          storage_status: 'saved',
          timing_ms: { total: 10 },
        } as InspectionResult
      }),
    } as unknown as DataSource

    const controller = new WebcamCaptureController({
      dataSource: mockDs,
      expectedProduct: 'bottle_a',
      autoCaptureEnabled: true,
      isStreaming: true,
    })

    // 1. Bottle 1 enters & fails
    controller.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)
    expect(inspectCalls).toHaveLength(1)
    expect(controller.phase).toBe('error_waiting_retry')
    const id1 = inspectCalls[0]?.client_request_id

    // 2. User removes bottle 1 (locator reports bottle absent for 2 ticks)
    controller.onLocatorTick(false, false)
    expect(controller.phase).toBe('error_waiting_retry')
    controller.onLocatorTick(false, false)
    // After 2 ticks absent, state transitions to waiting_bottle and pending error is cleared
    expect(controller.phase).toBe('waiting_bottle')
    expect(controller.failedRequest).toBeNull()
    expect(controller.error).toBeNull()

    // 3. Bottle 2 enters
    controller.onLocatorTick(true, true)
    expect(controller.phase).toBe('holding')
    await vi.advanceTimersByTimeAsync(800)

    // Bottle 2 triggers new capture with a brand new client_request_id
    expect(inspectCalls).toHaveLength(2)
    const id2 = inspectCalls[1]?.client_request_id
    expect(id2).not.toBe(id1)
    expect(controller.phase).toBe('awaiting_removal')
    expect(controller.result?.inspection_id).toBe('insp-bottle-2')
  })

  describe('P2 Regression: Parent expectedProduct prop updates and context synchronization', () => {
    it('A fails -> parent updates expectedProduct to B: disappears Retry of A, no further A sent, B starts with new ID', async () => {
      const inspectCalls: InspectionRequest[] = []
      let attempt = 0
      const mockDs = {
        createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
          inspectCalls.push(req)
          attempt++
          if (attempt === 1) {
            throw new Error('504 Gateway Timeout')
          }
          return {
            inspection_id: 'insp-bottle-b',
            client_request_id: req.client_request_id,
            result: 'PASS',
            expected_product: req.expected_product,
            storage_status: 'saved',
            timing_ms: { total: 10 },
          } as InspectionResult
        }),
      } as unknown as DataSource

      const controller = new WebcamCaptureController({
        dataSource: mockDs,
        expectedProduct: 'bottle_a',
        autoCaptureEnabled: true,
        isStreaming: true,
      })

      // 1. Product A fails on network timeout
      controller.onLocatorTick(true, true)
      await vi.advanceTimersByTimeAsync(800)

      expect(inspectCalls).toHaveLength(1)
      expect(inspectCalls[0]?.expected_product).toBe('bottle_a')
      expect(controller.phase).toBe('error_waiting_retry')
      expect(controller.canRetry).toBe(true)

      // 2. Parent component changes prop to expectedProduct="bottle_b"
      controller.setExpectedProduct('bottle_b')

      // 3. Assert: Retry for A is immediately cleared and disabled
      expect(controller.product).toBe('bottle_b')
      expect(controller.failedRequest).toBeNull()
      expect(controller.canRetry).toBe(false)
      expect(controller.error).toBeNull()
      expect(controller.phase).toBe('waiting_bottle')

      // Attempting to triggerRetry must be a no-op and send nothing
      await controller.triggerRetry()
      expect(inspectCalls).toHaveLength(1)

      // 4. Bottle B in view starts dwell countdown smoothly without being blocked by old error
      controller.onLocatorTick(true, true)
      expect(controller.phase).toBe('holding')
      await vi.advanceTimersByTimeAsync(800)

      // 5. Inspect call for B is dispatched with expected_product="bottle_b" and NEW client_request_id
      expect(inspectCalls).toHaveLength(2)
      expect(inspectCalls[1]?.expected_product).toBe('bottle_b')
      expect(inspectCalls[1]?.client_request_id).not.toBe(inspectCalls[0]?.client_request_id)
      expect(controller.phase).toBe('awaiting_removal')
      expect(controller.result?.inspection_id).toBe('insp-bottle-b')
    })

    it('Retry A in-flight -> parent changes expectedProduct to B: aborts and discards stale A result', async () => {
      let resolveRetry: (val: InspectionResult) => void = () => {}
      const inspectCalls: InspectionRequest[] = []

      const mockDs = {
        createInspection: vi.fn().mockImplementation((req: InspectionRequest) => {
          inspectCalls.push(req)
          if (inspectCalls.length === 1) {
            return Promise.reject(new Error('500 Error'))
          }
          return new Promise<InspectionResult>((resolve) => {
            resolveRetry = resolve
          })
        }),
      } as unknown as DataSource

      const controller = new WebcamCaptureController({
        dataSource: mockDs,
        expectedProduct: 'bottle_a',
        autoCaptureEnabled: true,
        isStreaming: true,
      })

      // 1. A fails initially
      controller.onLocatorTick(true, true)
      await vi.advanceTimersByTimeAsync(800)
      expect(controller.phase).toBe('error_waiting_retry')

      // 2. User clicks Retry for A -> in-flight
      const retryPromise = controller.triggerRetry()
      expect(controller.capturing).toBe(true)
      expect(inspectCalls).toHaveLength(2)

      // 3. While Retry A is pending, parent updates prop to bottle_b
      controller.setExpectedProduct('bottle_b')
      expect(controller.product).toBe('bottle_b')
      expect(controller.capturing).toBe(false)
      expect(controller.canRetry).toBe(false)

      // 4. Stale Retry A finishes later
      resolveRetry({
        inspection_id: 'stale-retry-a',
        client_request_id: inspectCalls[1]!.client_request_id,
        result: 'PASS',
        expected_product: 'bottle_a',
        storage_status: 'saved',
        timing_ms: { total: 10 },
      } as InspectionResult)
      await retryPromise
      await vi.advanceTimersByTimeAsync(50)

      // Result of A must NOT be accepted or shown in context B
      expect(controller.result).toBeNull()
      expect(controller.phase).toBe('waiting_bottle')
    })

    it('internal product button does not cause cyclic resets or interrupt ongoing dwell', async () => {
      const mockDs = {
        createInspection: vi.fn().mockResolvedValue({
          inspection_id: 'insp-01',
          result: 'PASS',
          expected_product: 'bottle_b',
        } as InspectionResult),
      } as unknown as DataSource

      const controller = new WebcamCaptureController({
        dataSource: mockDs,
        expectedProduct: 'bottle_a',
        autoCaptureEnabled: true,
        isStreaming: true,
      })

      // 1. User switches product internally
      controller.selectProduct('bottle_b')
      expect(controller.product).toBe('bottle_b')
      expect(controller.phase).toBe('waiting_bottle')

      // 2. Bottle starts dwelling on B
      controller.onLocatorTick(true, true)
      expect(controller.phase).toBe('holding')
      await vi.advanceTimersByTimeAsync(400) // halfway through dwell

      // 3. Parent re-renders with expectedProduct="bottle_b" (syncing with internal selection)
      controller.setExpectedProduct('bottle_b')

      // Dwell must NOT have been cancelled or reset back to 0!
      expect(controller.phase).toBe('holding')
      expect(controller.dwellTimer.isRunning).toBe(true)

      // Advance remaining 400ms to complete dwell
      await vi.advanceTimersByTimeAsync(400)
      expect(mockDs.createInspection).toHaveBeenCalledTimes(1)
      expect(controller.phase).toBe('awaiting_removal')
    })
  })
})
