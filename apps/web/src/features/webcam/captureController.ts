import { DwellTimer } from './dwellTimer'
import type { AutoCapturePhase } from './types'
import type { DataSource } from '../../lib/dataSource'
import type { InspectionRequest, InspectionResult } from '../../types/inspection'
import { describeApiError } from '../../lib/api'
import { generateClientRequestId } from './captureUtils'

export interface WebcamCaptureControllerOptions {
  dataSource: DataSource
  expectedProduct: string
  sourceKind?: 'live' | 'demo'
  autoCaptureEnabled?: boolean
  isStreaming?: boolean
  frameProvider?: () => Promise<{ blob: Blob }> | { blob: Blob }
  onInspectionComplete?: (result: InspectionResult) => void
  onStateChange?: () => void
}

export class WebcamCaptureController {
  private dataSource: DataSource
  private sourceKind: 'live' | 'demo'
  private selectedProduct: string
  private autoCaptureEnabled: boolean
  private isStreaming: boolean
  private frameProvider?: () => Promise<{ blob: Blob }> | { blob: Blob }
  private onInspectionComplete?: (result: InspectionResult) => void
  private onStateChange?: () => void

  private autoPhase: AutoCapturePhase = 'idle'
  private dwellProgress: number = 0
  private isCapturing: boolean = false
  private captureError: string | null = null
  private latestResult: InspectionResult | null = null
  private lastFailedRequest: InspectionRequest | null = null
  private bottleAbsentCount: number = 0
  private captureSeq: number = 0
  private inFlightAbort: AbortController | null = null
  private dwell: DwellTimer

  constructor(options: WebcamCaptureControllerOptions) {
    this.dataSource = options.dataSource
    this.selectedProduct = options.expectedProduct
    this.sourceKind = options.sourceKind ?? 'live'
    this.autoCaptureEnabled = options.autoCaptureEnabled ?? false
    this.isStreaming = options.isStreaming ?? true
    this.frameProvider = options.frameProvider
    this.onInspectionComplete = options.onInspectionComplete
    this.onStateChange = options.onStateChange
    this.autoPhase = this.autoCaptureEnabled && this.isStreaming ? 'waiting_bottle' : 'idle'

    this.dwell = new DwellTimer({
      dwellMs: 800,
      tickIntervalMs: 50,
      onProgress: (p) => {
        this.dwellProgress = p
        this.notify()
      },
      onComplete: (token) => {
        this.autoPhase = 'inspecting'
        this.notify()
        void this.triggerCapture(token)
      },
    })
  }

  // --- Getters for reactive state ---
  get phase(): AutoCapturePhase {
    return this.autoPhase
  }

  get product(): string {
    return this.selectedProduct
  }

  get capturing(): boolean {
    return this.isCapturing
  }

  get error(): string | null {
    return this.captureError
  }

  get result(): InspectionResult | null {
    return this.latestResult
  }

  get failedRequest(): InspectionRequest | null {
    return this.lastFailedRequest
  }

  get progress(): number {
    return this.dwellProgress
  }

  get canRetry(): boolean {
    return Boolean(
      this.lastFailedRequest &&
      this.lastFailedRequest.expected_product === this.selectedProduct &&
      !this.isCapturing
    )
  }

  get dwellTimer(): DwellTimer {
    return this.dwell
  }

  // --- Synchronizers / Setters ---
  setDataSource(ds: DataSource, sourceKind: 'live' | 'demo' = 'live'): void {
    this.dataSource = ds
    this.sourceKind = sourceKind
    this.dwell.invalidate()
    this.captureSeq++
    this.inFlightAbort?.abort()
    this.inFlightAbort = null
    this.isCapturing = false
    this.lastFailedRequest = null
    this.captureError = null
    this.latestResult = null
    this.autoPhase = this.autoCaptureEnabled && this.isStreaming ? 'waiting_bottle' : 'idle'
    this.notify()
  }

  setAutoCaptureEnabled(enabled: boolean): void {
    this.autoCaptureEnabled = enabled
    if (!enabled) {
      this.dwell.cancel()
      this.autoPhase = 'idle'
      this.bottleAbsentCount = 0
    } else if (this.isStreaming) {
      this.autoPhase = 'waiting_bottle'
    }
    this.notify()
  }

  setIsStreaming(streaming: boolean): void {
    this.isStreaming = streaming
    if (!streaming) {
      this.dwell.cancel()
      this.autoPhase = 'idle'
      this.bottleAbsentCount = 0
    } else if (this.autoCaptureEnabled) {
      this.autoPhase = 'waiting_bottle'
    }
    this.notify()
  }

  setFrameProvider(provider: () => Promise<{ blob: Blob }> | { blob: Blob }): void {
    this.frameProvider = provider
  }

  // --- Central Unified Reset for Product Change (via prop or button) ---
  resetProductContext(newProdId: string): void {
    // 1. Invalidate dwell timer session token
    this.dwell.invalidate()

    // 2. Increment sequence & abort in-flight capture or retry
    this.captureSeq++
    this.inFlightAbort?.abort()
    this.inFlightAbort = null
    this.isCapturing = false

    // 3. Clear failed request of previous product and error
    this.lastFailedRequest = null
    this.captureError = null

    // 4. Clear stale inspection result of previous product
    this.latestResult = null
    this.bottleAbsentCount = 0

    // 5. Reset autoPhase to waiting_bottle so new product is not blocked by previous error
    if (this.autoCaptureEnabled && this.isStreaming) {
      this.autoPhase = 'waiting_bottle'
    }

    // 6. Set active product
    this.selectedProduct = newProdId
    this.notify()
  }

  setExpectedProduct(newProdId: string): void {
    if (newProdId !== this.selectedProduct) {
      this.resetProductContext(newProdId)
    }
  }

  selectProduct(newProdId: string): void {
    if (newProdId !== this.selectedProduct) {
      this.resetProductContext(newProdId)
    }
  }

  // --- Capture and Retry actions ---
  async triggerCapture(token?: number): Promise<InspectionResult | null> {
    if (token !== undefined && !this.dwell.isTokenValid(token)) {
      return null
    }
    if (!this.isStreaming || this.isCapturing) {
      return null
    }

    const sessionTokenSnapshot = this.dwell.token
    const seq = ++this.captureSeq
    this.inFlightAbort?.abort()
    const abortCtrl = new AbortController()
    this.inFlightAbort = abortCtrl

    this.isCapturing = true
    this.captureError = null
    this.notify()

    let frameBlob: Blob
    try {
      if (this.frameProvider) {
        const frame = await this.frameProvider()
        frameBlob = frame.blob
      } else {
        frameBlob = new Blob(['webcam-frame'], { type: 'image/jpeg' })
      }
    } catch {
      frameBlob = new Blob(['webcam-frame'], { type: 'image/jpeg' })
    }

    if (
      !this.dwell.isTokenValid(sessionTokenSnapshot) ||
      seq !== this.captureSeq ||
      abortCtrl.signal.aborted
    ) {
      return null
    }

    const currentReq: InspectionRequest = {
      image: frameBlob,
      imageName: 'webcam-capture.jpg',
      expected_product: this.selectedProduct,
      source_mode: 'webcam',
      client_request_id: generateClientRequestId(),
      demo: this.sourceKind === 'demo',
    }

    try {
      const result = await this.dataSource.createInspection(currentReq, abortCtrl.signal)

      if (
        !this.dwell.isTokenValid(sessionTokenSnapshot) ||
        seq !== this.captureSeq ||
        abortCtrl.signal.aborted
      ) {
        return null
      }

      this.lastFailedRequest = null
      this.captureError = null
      this.latestResult = result
      this.onInspectionComplete?.(result)

      if (this.autoCaptureEnabled) {
        this.autoPhase = 'awaiting_removal'
      }
      this.notify()
      return result
    } catch (err: any) {
      if (
        !this.dwell.isTokenValid(sessionTokenSnapshot) ||
        seq !== this.captureSeq ||
        abortCtrl.signal.aborted
      ) {
        return null
      }

      this.lastFailedRequest = currentReq
      this.captureError = describeApiError(err)
      if (this.autoCaptureEnabled) {
        this.autoPhase = 'error_waiting_retry'
      }
      this.notify()
      return null
    } finally {
      if (seq === this.captureSeq) {
        this.isCapturing = false
        this.notify()
      }
    }
  }

  async triggerRetry(): Promise<InspectionResult | null> {
    const failedReq = this.lastFailedRequest
    if (!failedReq || this.isCapturing) return null

    // Guard: Failed request must belong to the currently active product
    if (failedReq.expected_product !== this.selectedProduct) {
      this.lastFailedRequest = null
      this.notify()
      return null
    }

    const sessionTokenSnapshot = this.dwell.token
    const seq = ++this.captureSeq
    this.inFlightAbort?.abort()
    const abortCtrl = new AbortController()
    this.inFlightAbort = abortCtrl

    this.isCapturing = true
    this.captureError = null
    this.notify()

    try {
      const result = await this.dataSource.createInspection(failedReq, abortCtrl.signal)

      if (
        !this.dwell.isTokenValid(sessionTokenSnapshot) ||
        seq !== this.captureSeq ||
        abortCtrl.signal.aborted
      ) {
        return null
      }

      this.lastFailedRequest = null
      this.captureError = null
      this.latestResult = result
      this.onInspectionComplete?.(result)

      if (this.autoCaptureEnabled) {
        this.autoPhase = 'awaiting_removal'
      }
      this.notify()
      return result
    } catch (err: any) {
      if (
        !this.dwell.isTokenValid(sessionTokenSnapshot) ||
        seq !== this.captureSeq ||
        abortCtrl.signal.aborted
      ) {
        return null
      }

      this.captureError = describeApiError(err)
      if (this.autoCaptureEnabled) {
        this.autoPhase = 'error_waiting_retry'
      }
      this.notify()
      return null
    } finally {
      if (seq === this.captureSeq) {
        this.isCapturing = false
        this.notify()
      }
    }
  }

  // --- Locator / Dwell state machine tick ---
  onLocatorTick(usable: boolean, bottleVisible: boolean): void {
    if (!this.autoCaptureEnabled || !this.isStreaming) {
      this.dwell.cancel()
      this.autoPhase = 'idle'
      this.bottleAbsentCount = 0
      this.notify()
      return
    }

    // Phase: awaiting_removal -> wait for user to take bottle out
    if (this.autoPhase === 'awaiting_removal') {
      if (!bottleVisible && !usable) {
        this.bottleAbsentCount++
        if (this.bottleAbsentCount >= 2) {
          this.autoPhase = 'waiting_bottle'
          this.dwell.cancel()
          this.bottleAbsentCount = 0
          this.notify()
        }
      } else {
        this.bottleAbsentCount = 0
      }
      return
    }

    // Phase: error_waiting_retry -> hold and wait for user to retry or remove bottle
    if (this.autoPhase === 'error_waiting_retry') {
      this.dwell.cancel()
      if (!bottleVisible && !usable) {
        this.bottleAbsentCount++
        if (this.bottleAbsentCount >= 2) {
          this.lastFailedRequest = null
          this.captureError = null
          this.autoPhase = 'waiting_bottle'
          this.dwell.cancel()
          this.bottleAbsentCount = 0
          this.notify()
        }
      } else {
        this.bottleAbsentCount = 0
      }
      return
    }

    // Guard: never auto-dwell if there is a pending failed request awaiting retry
    if (this.lastFailedRequest) {
      this.dwell.cancel()
      return
    }

    if (this.autoPhase === 'inspecting' || this.isCapturing) {
      return
    }

    if (!usable) {
      this.dwell.cancel()
      if (this.autoPhase !== 'waiting_bottle') {
        this.autoPhase = 'waiting_bottle'
        this.notify()
      }
      return
    }

    // Usable bottle in view -> start dwell countdown
    if (!this.dwell.hasStarted) {
      this.autoPhase = 'holding'
      this.dwell.start()
      this.notify()
    }
  }

  returnToLive(): void {
    this.dwell.cancel()
    this.bottleAbsentCount = 0
    this.lastFailedRequest = null
    this.captureError = null
    if (this.autoCaptureEnabled) {
      this.autoPhase = 'waiting_bottle'
    }
    this.notify()
  }

  dispose(): void {
    this.dwell.invalidate()
    this.captureSeq++
    this.inFlightAbort?.abort()
    this.inFlightAbort = null
  }

  private notify(): void {
    this.onStateChange?.()
  }
}
