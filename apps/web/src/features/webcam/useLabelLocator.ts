import { useEffect, useRef, useState } from 'react'
import { locateLabel } from '../../lib/api'
import type { DataSource } from '../../lib/dataSource'
import type { SourceKind } from '../../lib/AppData'
import type { LocateResult } from '../../types/inspection'
import { captureThumbnail } from './captureUtils'
import { webcamGuidance } from './guidance'
import type { GuidanceInfo } from './types'

export interface UseLabelLocatorOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isStreaming: boolean
  expectedProduct: string
  enabled?: boolean
  intervalMs?: number
  dataSource?: DataSource
  sourceKind?: SourceKind
}

const DEFAULT_GUIDANCE: GuidanceInfo = {
  text: 'กำลังค้นหาฉลาก...',
  subtext: 'ถือขวดน้ำให้อยู่กึ่งกลางกรอบกล้อง',
  tone: 'info',
  readyToCapture: false,
}

export function useLabelLocator({
  videoRef,
  isStreaming,
  expectedProduct,
  enabled = true,
  intervalMs = 650,
  dataSource,
  sourceKind = 'live',
}: UseLabelLocatorOptions) {
  const [locateResult, setLocateResult] = useState<LocateResult | null>(null)
  const [guidance, setGuidance] = useState<GuidanceInfo>(DEFAULT_GUIDANCE)
  const [isLocating, setIsLocating] = useState<boolean>(false)
  const [lastCheckTime, setLastCheckTime] = useState<number>(0)

  const inFlightRef = useRef<boolean>(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)

  // Reset locator state when datasource or source mode changes
  useEffect(() => {
    setLocateResult(null)
    setGuidance(DEFAULT_GUIDANCE)
  }, [dataSource, sourceKind])


  useEffect(() => {
    if (!isStreaming || !enabled) {
      setLocateResult(null)
      setGuidance({
        text: isStreaming ? 'ระบบค้นหาฉลากปิดอยู่' : 'กล้องยังไม่ได้เปิดทำงาน',
        subtext: isStreaming ? 'กดเปิดระบบ Locator เพื่อรับคำแนะนำ' : 'กดปุ่มเปิดกล้องเพื่อเริ่มใช้งาน',
        tone: 'info',
        readyToCapture: false,
      })
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      inFlightRef.current = false
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    let isSubscribed = true

    // Initialize to searching guidance as soon as stream is active
    setGuidance(DEFAULT_GUIDANCE)

    const runLocatorCycle = async () => {
      // Guard: video must be playing with valid dimensions
      const video = videoRef.current
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
        if (isSubscribed) {
          timerRef.current = window.setTimeout(runLocatorCycle, 200)
        }
        return
      }

      // Guard: Maximum 1 in-flight request at a time (Rule 6.4)
      if (inFlightRef.current) {
        return
      }

      inFlightRef.current = true
      setIsLocating(true)

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        // Extract downscaled thumbnail for fast network transport
        const thumbnailBlob = await captureThumbnail(video, 640, 0.85)

        if (!isSubscribed || abortController.signal.aborted) {
          return
        }

        const result = dataSource
          ? await dataSource.locateLabel(thumbnailBlob, expectedProduct, abortController.signal)
          : await locateLabel(thumbnailBlob, expectedProduct, abortController.signal)

        if (isSubscribed && !abortController.signal.aborted) {
          setLocateResult(result)
          setGuidance(webcamGuidance(result))
          setLastCheckTime(Date.now())
        }
      } catch (err: any) {
        // Suppress abort errors cleanly
        if (err?.name !== 'AbortError' && isSubscribed) {
          console.debug('Locator tick error:', err)
          setGuidance({
            text: sourceKind === 'demo' ? 'กำลังจำลองผลค้นหาฉลาก (DEMO)...' : 'กำลังรอการเชื่อมต่อ Backend...',
            subtext:
              sourceKind === 'demo'
                ? 'โหมดจำลองตามสถานการณ์ที่เลือก'
                : 'ตรวจสอบให้แน่ใจว่า Backend รันอยู่ที่พอร์ต 8000',
            tone: 'warning',
            readyToCapture: false,
          })
        }
      } finally {
        inFlightRef.current = false
        if (isSubscribed) {
          setIsLocating(false)
          // Schedule next run after intervalMs
          timerRef.current = window.setTimeout(runLocatorCycle, intervalMs)
        }
      }
    }

    // Start cycle
    timerRef.current = window.setTimeout(runLocatorCycle, 300)

    return () => {
      isSubscribed = false
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      inFlightRef.current = false
    }
  }, [enabled, expectedProduct, intervalMs, isStreaming, videoRef, dataSource, sourceKind])

  return {
    locateResult,
    guidance,
    isLocating,
    lastCheckTime,
  }
}
