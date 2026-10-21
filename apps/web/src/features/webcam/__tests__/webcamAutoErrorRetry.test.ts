import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DwellTimer } from '../dwellTimer'
import type { AutoCapturePhase } from '../types'
import type { DataSource } from '../../../lib/dataSource'
import type { InspectionRequest, InspectionResult } from '../../../types/inspection'
import { describeApiError } from '../../../lib/api'

describe('Webcam Auto-Capture Post-Error & Idempotent Retry Robustness (17-4 / P2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Test harness simulating CameraPanel's auto-capture state machine,
   * dwell timer, and retry controller faithfully.
   */
  function createAutoCaptureHarness(ds: DataSource) {
    let autoPhase: AutoCapturePhase = 'idle'
    let autoCaptureEnabled = false
    let isStreaming = true
    let selectedProduct = 'bottle_a'
    let lastFailedRequest: InspectionRequest | null = null
    let captureError: string | null = null
    let latestResult: InspectionResult | null = null
    let bottleAbsentCount = 0
    let captureSeq = 0
    let inFlightAbort: AbortController | null = null
    let isCapturing = false

    const dwell = new DwellTimer({
      dwellMs: 800,
      tickIntervalMs: 50,
      onProgress: () => {},
      onComplete: (token) => {
        autoPhase = 'inspecting'
        void triggerCapture(token)
      },
    })

    const triggerCapture = async (token?: number) => {
      if (token !== undefined && !dwell.isTokenValid(token)) return
      if (!isStreaming || isCapturing) return

      const sessionTokenSnapshot = dwell.token
      const seq = ++captureSeq
      inFlightAbort?.abort()
      const abortCtrl = new AbortController()
      inFlightAbort = abortCtrl

      isCapturing = true
      captureError = null

      const currentReq: InspectionRequest = {
        image: new Blob(['fake-img'], { type: 'image/jpeg' }),
        imageName: 'webcam-capture.jpg',
        expected_product: selectedProduct,
        source_mode: 'webcam',
        client_request_id: `req-${seq}`,
        demo: false,
      }

      try {
        const result = await ds.createInspection(currentReq, abortCtrl.signal)
        if (!dwell.isTokenValid(sessionTokenSnapshot) || seq !== captureSeq || abortCtrl.signal.aborted) {
          return
        }
        lastFailedRequest = null
        captureError = null
        latestResult = result
        if (autoCaptureEnabled) {
          autoPhase = 'awaiting_removal'
        }
      } catch (err: any) {
        if (!dwell.isTokenValid(sessionTokenSnapshot) || seq !== captureSeq || abortCtrl.signal.aborted) {
          return
        }
        lastFailedRequest = currentReq
        captureError = describeApiError(err)
        if (autoCaptureEnabled) {
          autoPhase = 'error_waiting_retry'
        }
      } finally {
        if (seq === captureSeq) {
          isCapturing = false
        }
      }
    }

    const triggerRetry = async () => {
      if (!lastFailedRequest || isCapturing) return

      const sessionTokenSnapshot = dwell.token
      const seq = ++captureSeq
      inFlightAbort?.abort()
      const abortCtrl = new AbortController()
      inFlightAbort = abortCtrl

      isCapturing = true
      captureError = null

      try {
        const result = await ds.createInspection(lastFailedRequest, abortCtrl.signal)
        if (!dwell.isTokenValid(sessionTokenSnapshot) || seq !== captureSeq || abortCtrl.signal.aborted) {
          return
        }
        lastFailedRequest = null
        captureError = null
        latestResult = result
        if (autoCaptureEnabled) {
          autoPhase = 'awaiting_removal'
        }
      } catch (err: any) {
        if (!dwell.isTokenValid(sessionTokenSnapshot) || seq !== captureSeq || abortCtrl.signal.aborted) {
          return
        }
        captureError = describeApiError(err)
        if (autoCaptureEnabled) {
          autoPhase = 'error_waiting_retry'
        }
      } finally {
        if (seq === captureSeq) {
          isCapturing = false
        }
      }
    }

    const onLocatorTick = (usable: boolean, bottleVisible: boolean) => {
      if (!autoCaptureEnabled || !isStreaming) {
        dwell.cancel()
        autoPhase = 'idle'
        bottleAbsentCount = 0
        return
      }

      if (autoPhase === 'awaiting_removal') {
        if (!bottleVisible && !usable) {
          bottleAbsentCount++
          if (bottleAbsentCount >= 2) {
            autoPhase = 'waiting_bottle'
            dwell.cancel()
            bottleAbsentCount = 0
          }
        } else {
          bottleAbsentCount = 0
        }
        return
      }

      if (autoPhase === 'error_waiting_retry') {
        dwell.cancel()
        if (!bottleVisible && !usable) {
          bottleAbsentCount++
          if (bottleAbsentCount >= 2) {
            lastFailedRequest = null
            captureError = null
            autoPhase = 'waiting_bottle'
            dwell.cancel()
            bottleAbsentCount = 0
          }
        } else {
          bottleAbsentCount = 0
        }
        return
      }

      if (lastFailedRequest) {
        dwell.cancel()
        return
      }

      if (autoPhase === 'inspecting' || isCapturing) return

      if (!usable) {
        dwell.cancel()
        if (autoPhase !== 'waiting_bottle') {
          autoPhase = 'waiting_bottle'
        }
        return
      }

      if (!dwell.hasStarted) {
        autoPhase = 'holding'
        dwell.start()
      }
    }

    const selectProduct = (prodId: string) => {
      selectedProduct = prodId
      lastFailedRequest = null
      captureError = null
      dwell.invalidate()
      captureSeq++
      inFlightAbort?.abort()
      isCapturing = false
      if (autoCaptureEnabled && (autoPhase === 'holding' || autoPhase === 'error_waiting_retry' || autoPhase === 'inspecting')) {
        autoPhase = 'waiting_bottle'
      }
    }

    return {
      get autoPhase() { return autoPhase },
      set autoPhase(p) { autoPhase = p },
      get autoCaptureEnabled() { return autoCaptureEnabled },
      set autoCaptureEnabled(e) { autoCaptureEnabled = e },
      get isStreaming() { return isStreaming },
      set isStreaming(s) { isStreaming = s },
      get selectedProduct() { return selectedProduct },
      get lastFailedRequest() { return lastFailedRequest },
      get captureError() { return captureError },
      get latestResult() { return latestResult },
      get isCapturing() { return isCapturing },
      dwell,
      onLocatorTick,
      triggerCapture,
      triggerRetry,
      selectProduct,
    }
  }

  it('criterion 1: network timeout on first request keeps bottle stationary for 5s with only 1 request dispatched', async () => {
    const inspectCalls: InspectionRequest[] = []
    const mockDs = {
      createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
        inspectCalls.push(req)
        throw new Error('504 Gateway Timeout')
      }),
    } as unknown as DataSource

    const harness = createAutoCaptureHarness(mockDs)
    harness.autoCaptureEnabled = true
    harness.autoPhase = 'waiting_bottle'

    // Bottle enters and is usable
    harness.onLocatorTick(true, true)
    expect(harness.autoPhase).toBe('holding')

    // Advance 800ms to complete dwell and trigger first capture
    await vi.advanceTimersByTimeAsync(800)

    // First request failed -> should transition to error_waiting_retry
    expect(inspectCalls).toHaveLength(1)
    expect(inspectCalls[0]?.client_request_id).toBe('req-1')
    expect(harness.autoPhase).toBe('error_waiting_retry')
    expect(harness.lastFailedRequest?.client_request_id).toBe('req-1')
    expect(harness.captureError).toBeTruthy()

    // Simulate bottle held stationary in front of camera for 5 seconds (50 locator ticks at 100ms)
    for (let i = 0; i < 50; i++) {
      harness.onLocatorTick(true, true)
      await vi.advanceTimersByTimeAsync(100)
    }

    // Must strictly have sent only 1 request; no automatic duplicate triggers
    expect(inspectCalls).toHaveLength(1)
    expect(harness.autoPhase).toBe('error_waiting_retry')
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

    const harness = createAutoCaptureHarness(mockDs)
    harness.autoCaptureEnabled = true
    harness.autoPhase = 'waiting_bottle'

    // Trigger dwell & first failed capture
    harness.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)

    expect(inspectCalls).toHaveLength(1)
    expect(harness.autoPhase).toBe('error_waiting_retry')
    const originalReqId = inspectCalls[0]?.client_request_id

    // User explicitly clicks Retry
    await harness.triggerRetry()

    // Second call must use identical client_request_id and request fields
    expect(inspectCalls).toHaveLength(2)
    expect(inspectCalls[1]?.client_request_id).toBe(originalReqId)
    expect(inspectCalls[1]?.expected_product).toBe(inspectCalls[0]?.expected_product)
    expect(inspectCalls[1]?.source_mode).toBe(inspectCalls[0]?.source_mode)

    // After success: lastFailedRequest cleared, phase becomes awaiting_removal
    expect(harness.lastFailedRequest).toBeNull()
    expect(harness.autoPhase).toBe('awaiting_removal')
    expect(harness.latestResult?.inspection_id).toBe('insp-idemp-01')

    // While bottle remains visible, no new capture should trigger
    harness.onLocatorTick(true, true)
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

    const harness = createAutoCaptureHarness(mockDs)
    harness.autoCaptureEnabled = true
    harness.autoPhase = 'waiting_bottle'

    // Initial capture fails
    harness.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)
    expect(inspectCalls).toHaveLength(1)
    expect(harness.autoPhase).toBe('error_waiting_retry')

    // First retry fails
    await harness.triggerRetry()
    expect(inspectCalls).toHaveLength(2)
    expect(harness.autoPhase).toBe('error_waiting_retry')

    // Second retry fails
    await harness.triggerRetry()
    expect(inspectCalls).toHaveLength(3)
    expect(harness.autoPhase).toBe('error_waiting_retry')

    // All retries used the same client_request_id
    expect(inspectCalls[1]?.client_request_id).toBe(inspectCalls[0]?.client_request_id)
    expect(inspectCalls[2]?.client_request_id).toBe(inspectCalls[0]?.client_request_id)

    // Ticks with bottle present do not fire new requests
    for (let i = 0; i < 20; i++) {
      harness.onLocatorTick(true, true)
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

    const harness = createAutoCaptureHarness(mockDs)
    harness.autoCaptureEnabled = true
    harness.autoPhase = 'waiting_bottle'

    // First capture starts and is pending
    harness.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)

    // User switches product while request is in-flight
    harness.selectProduct('bottle_b')
    expect(harness.autoPhase).toBe('waiting_bottle')

    // Later, the old in-flight request resolves
    resolveInspection?.({
      inspection_id: 'stale-insp-01',
      client_request_id: 'req-1',
      result: 'PASS',
      expected_product: 'bottle_a',
      storage_status: 'saved',
      timing_ms: { total: 10 },
    } as InspectionResult)

    await vi.advanceTimersByTimeAsync(50)

    // Stale result must be discarded: latestResult remains null
    expect(harness.latestResult).toBeNull()
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

    const harness = createAutoCaptureHarness(mockDs)
    harness.autoCaptureEnabled = true
    harness.autoPhase = 'waiting_bottle'

    // 1. Bottle 1 enters & fails
    harness.onLocatorTick(true, true)
    await vi.advanceTimersByTimeAsync(800)
    expect(inspectCalls).toHaveLength(1)
    expect(harness.autoPhase).toBe('error_waiting_retry')
    const id1 = inspectCalls[0]?.client_request_id

    // 2. User removes bottle 1 (locator reports bottle absent for 2 ticks)
    harness.onLocatorTick(false, false)
    expect(harness.autoPhase).toBe('error_waiting_retry')
    harness.onLocatorTick(false, false)
    // After 2 ticks absent, state transitions to waiting_bottle and pending error is cleared
    expect(harness.autoPhase).toBe('waiting_bottle')
    expect(harness.lastFailedRequest).toBeNull()
    expect(harness.captureError).toBeNull()

    // 3. Bottle 2 enters
    harness.onLocatorTick(true, true)
    expect(harness.autoPhase).toBe('holding')
    await vi.advanceTimersByTimeAsync(800)

    // Bottle 2 triggers new capture with a brand new client_request_id
    expect(inspectCalls).toHaveLength(2)
    const id2 = inspectCalls[1]?.client_request_id
    expect(id2).not.toBe(id1)
    expect(harness.autoPhase).toBe('awaiting_removal')
    expect(harness.latestResult?.inspection_id).toBe('insp-bottle-2')
  })
})
