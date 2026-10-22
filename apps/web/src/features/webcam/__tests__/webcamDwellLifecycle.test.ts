import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DwellTimer } from '../dwellTimer'
import { liveDataSource } from '../../../lib/dataSource'
import { createDemoDataSource } from '../../../demo/demoDataSource'
import type { InspectionRequest } from '../../../types/inspection'

describe('Webcam Dwell Timer Lifecycle and Auto-Capture Robustness (17-1 & 17-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('17-1: Session Invalidation and Dwell Timer Cancellation on Mode/Source Switch', () => {
    it('cancels dwell countdown and ignores completion if session is invalidated at 400ms', () => {
      let completedToken: number | null = null
      let lastProgress = 0

      const timer = new DwellTimer({
        dwellMs: 800,
        tickIntervalMs: 50,
        onProgress: (p) => {
          lastProgress = p
        },
        onComplete: (token) => {
          completedToken = token
        },
      })

      // 1. Bottle detected in LIVE mode: start dwell
      const initialToken = timer.start()
      expect(timer.isRunning).toBe(true)
      expect(timer.hasStarted).toBe(true)

      // 2. Advance 400ms (halfway)
      vi.advanceTimersByTime(400)
      expect(lastProgress).toBeGreaterThanOrEqual(40)
      expect(completedToken).toBeNull()

      // 3. User switches to DEMO mode before 800ms completes -> invalidate session
      const newToken = timer.invalidate()
      expect(newToken).toBe(initialToken + 1)
      expect(timer.isRunning).toBe(false)
      expect(timer.hasStarted).toBe(false)
      expect(lastProgress).toBe(0)
      expect(timer.isTokenValid(initialToken)).toBe(false)

      // 4. Advance time past the original 800ms mark
      vi.advanceTimersByTime(600)

      // 5. Assert: onComplete was NEVER called for the cancelled session
      expect(completedToken).toBeNull()
    })

    it('prevents stale dwell callbacks from dispatching inspections to live backend after switching to demo', async () => {
      const liveInspectSpy = vi.spyOn(liveDataSource, 'createInspection')
      const demoDs = createDemoDataSource(() => 'pass')
      const demoInspectSpy = vi.spyOn(demoDs, 'createInspection')

      let currentSourceKind: 'live' | 'demo' = 'live'
      let currentDataSource = liveDataSource

      const timer = new DwellTimer({
        dwellMs: 800,
        tickIntervalMs: 50,
        onComplete: async (token) => {
          // Guard: Reject stale session token
          if (!timer.isTokenValid(token)) {
            return
          }
          const req: InspectionRequest = {
            image: new Blob(['fake'], { type: 'image/jpeg' }),
            imageName: 'capture.jpg',
            expected_product: 'bottle_a',
            source_mode: 'webcam',
            client_request_id: 'test-req',
            demo: currentSourceKind === 'demo',
          }
          await currentDataSource.createInspection(req)
        },
      })

      // Start dwell in LIVE mode
      timer.start()

      // Progress 450ms
      vi.advanceTimersByTime(450)
      expect(liveInspectSpy).not.toHaveBeenCalled()

      // User switches to DEMO mode: update source and invalidate timer
      currentSourceKind = 'demo'
      currentDataSource = demoDs as any
      timer.invalidate()

      // Advance past remaining time
      vi.advanceTimersByTime(600)

      // Verify LIVE backend was NEVER called under any circumstance
      expect(liveInspectSpy).not.toHaveBeenCalled()
      expect(demoInspectSpy).not.toHaveBeenCalled()

      liveInspectSpy.mockRestore()
      demoInspectSpy.mockRestore()
    })

    it('cancels dwell timer if user changes expected product during countdown', () => {
      let completeCount = 0

      const timer = new DwellTimer({
        dwellMs: 800,
        tickIntervalMs: 50,
        onComplete: () => {
          completeCount++
        },
      })

      timer.start()
      vi.advanceTimersByTime(350)
      expect(completeCount).toBe(0)

      // Product changed from bottle_a to bottle_b -> invalidate
      timer.invalidate()

      vi.advanceTimersByTime(600)
      expect(completeCount).toBe(0)
    })
  })

  describe('17-2: Restarting Dwell after Toggling Auto-Capture Off and On', () => {
    it('resets start state cleanly when toggled off, allowing re-enabling without lockup', () => {
      let completedTokens: number[] = []

      const timer = new DwellTimer({
        dwellMs: 800,
        tickIntervalMs: 50,
        onComplete: (token) => {
          completedTokens.push(token)
        },
      })

      // 1. Initial dwell started
      timer.start()
      vi.advanceTimersByTime(300)
      expect(timer.hasStarted).toBe(true)

      // 2. User toggles auto-capture OFF
      timer.cancel()
      expect(timer.isRunning).toBe(false)
      expect(timer.hasStarted).toBe(false)

      // Advance time while off - no trigger should occur
      vi.advanceTimersByTime(1000)
      expect(completedTokens).toEqual([])

      // 3. User toggles auto-capture ON again: must be able to start cleanly
      expect(timer.hasStarted).toBe(false)
      const token2 = timer.start()
      expect(timer.hasStarted).toBe(true)
      expect(timer.isRunning).toBe(true)

      // 4. Advance full 800ms
      vi.advanceTimersByTime(850)

      // 5. Verification: timer completed successfully for the new cycle
      expect(completedTokens).toEqual([token2])
      expect(timer.isRunning).toBe(false)
      expect(timer.hasStarted).toBe(false)
    })

    it('cancels dwell countdown if bottle loses focus before 800ms and restarts when bottle re-enters', () => {
      let completeCount = 0

      const timer = new DwellTimer({
        dwellMs: 800,
        tickIntervalMs: 50,
        onComplete: () => {
          completeCount++
        },
      })

      // Bottle placed
      timer.start()
      vi.advanceTimersByTime(500)

      // Bottle moves out / blurs -> cancel
      timer.cancel()
      expect(timer.hasStarted).toBe(false)

      // Wait 400ms while blurred
      vi.advanceTimersByTime(400)
      expect(completeCount).toBe(0)

      // Bottle placed back steadily
      timer.start()
      vi.advanceTimersByTime(800)
      expect(completeCount).toBe(1)
    })
  })

  describe('Debounced Awaiting-Removal and Next Bottle Manual Bypass', () => {
    it('requires consecutive absent frames before leaving awaiting_removal state', () => {
      let autoPhase: 'idle' | 'waiting_bottle' | 'holding' | 'inspecting' | 'awaiting_removal' = 'awaiting_removal'
      let absentCount = 0

      const handleLocatorSample = (bottleSeen: boolean) => {
        if (autoPhase === 'awaiting_removal') {
          if (!bottleSeen) {
            absentCount++
            if (absentCount >= 2) {
              autoPhase = 'waiting_bottle'
              absentCount = 0
            }
          } else {
            absentCount = 0
          }
        }
      }

      // 1. Single flicker of bottle lost (e.g. 1 frame)
      handleLocatorSample(false)
      expect(autoPhase).toBe('awaiting_removal') // must not leave prematurely
      expect(absentCount).toBe(1)

      // 2. Bottle still visible on next frame (flicker recovered)
      handleLocatorSample(true)
      expect(autoPhase).toBe('awaiting_removal')
      expect(absentCount).toBe(0)

      // 3. Bottle genuinely removed (2 consecutive samples absent)
      handleLocatorSample(false)
      expect(autoPhase).toBe('awaiting_removal')
      handleLocatorSample(false)
      expect(autoPhase).toBe('waiting_bottle')
      expect(absentCount).toBe(0)
    })

    it('allows immediate manual reset to waiting_bottle via Next Bottle action', () => {
      let autoPhase = 'awaiting_removal'
      let viewMode = 'frozen'
      let absentCount = 3

      const handleReturnToLive = () => {
        viewMode = 'live'
        autoPhase = 'waiting_bottle'
        absentCount = 0
      }

      handleReturnToLive()
      expect(autoPhase).toBe('waiting_bottle')
      expect(viewMode).toBe('live')
      expect(absentCount).toBe(0)
    })
  })
})
