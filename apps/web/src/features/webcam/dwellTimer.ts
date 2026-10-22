/**
 * Dwell Timer and Auto-Capture Session Controller (Module 04-B)
 *
 * Manages the 800ms dwell countdown for auto-capture with generation token
 * invalidation to prevent stale captures when datasource, product, or camera switch.
 */

export interface DwellTimerOptions {
  dwellMs?: number
  tickIntervalMs?: number
  onProgress?: (progress: number) => void
  onComplete: (token: number) => void
}

export class DwellTimer {
  private timerId: ReturnType<typeof setInterval> | null = null
  private startTime: number | null = null
  private sessionToken: number = 0
  private dwellMs: number
  private tickIntervalMs: number
  private onProgress?: (progress: number) => void
  private onComplete: (token: number) => void

  constructor(options: DwellTimerOptions) {
    this.dwellMs = options.dwellMs ?? 800
    this.tickIntervalMs = options.tickIntervalMs ?? 50
    this.onProgress = options.onProgress
    this.onComplete = options.onComplete
  }

  get isRunning(): boolean {
    return this.timerId !== null
  }

  get token(): number {
    return this.sessionToken
  }

  get elapsed(): number {
    return this.startTime ? Math.max(0, Date.now() - this.startTime) : 0
  }

  get hasStarted(): boolean {
    return this.startTime !== null
  }

  /**
   * Starts or restarts the dwell countdown.
   * Clears any active timer and resets start time.
   */
  start(): number {
    this.cancelTimerOnly()
    this.startTime = Date.now()
    this.onProgress?.(0)
    const currentToken = this.sessionToken

    this.timerId = setInterval(() => {
      // Invalidation check: if session changed or cancelled, abort
      if (this.sessionToken !== currentToken || this.startTime === null) {
        this.cancel()
        return
      }

      const elapsed = Date.now() - this.startTime
      const progress = Math.min(100, Math.round((elapsed / this.dwellMs) * 100))
      this.onProgress?.(progress)

      if (elapsed >= this.dwellMs) {
        this.cancel()
        if (this.sessionToken === currentToken) {
          this.onComplete(currentToken)
        }
      }
    }, this.tickIntervalMs)

    return currentToken
  }

  /**
   * Stops the countdown, clears timer and start time, and resets progress to 0.
   * Does NOT increment the session token.
   */
  cancel(): void {
    this.cancelTimerOnly()
    this.startTime = null
    this.onProgress?.(0)
  }

  private cancelTimerOnly(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  }

  /**
   * Invalidates the current session by incrementing the token,
   * cancels any active timer, resets start time and progress.
   * Any pending or in-flight callbacks from previous sessions will be ignored.
   */
  invalidate(): number {
    this.sessionToken++
    this.cancel()
    return this.sessionToken
  }

  /**
   * Verifies if a given token matches the current session token.
   */
  isTokenValid(token: number): boolean {
    return token === this.sessionToken
  }
}
