import { useEffect, useRef, useState } from 'react'
import { locateLabel } from '../../lib/api'
import type { DataSource } from '../../lib/dataSource'
import type { SourceKind } from '../../lib/AppData'
import type { LocateResult } from '../../types/inspection'
import { captureThumbnail } from './captureUtils'
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

  /**
   * Derive dynamic user guidance based on backend LocateResult and quality flags
   */
  const computeGuidance = (result: LocateResult | null): GuidanceInfo => {
    if (!result) {
      return {
        text: 'กำลังค้นหาฉลาก...',
        subtext: 'ถือขวดน้ำให้อยู่กึ่งกลางกรอบกล้อง',
        tone: 'info',
        readyToCapture: false,
      }
    }

    const { quality, reason, usable_view } = result

    // 1. Quality gate: Blur check
    if (quality.sharp_enough === false || reason === 'blurred_image') {
      return {
        text: '⚠️ ภาพเบลอ กรุณาถือขวดให้นิ่ง',
        subtext: 'ความคมชัดต่ำกว่าเกณฑ์ หยุดนิ่งสักครู่เพื่อให้กล้องจับโฟกัส',
        tone: 'warning',
        readyToCapture: false,
      }
    }

    // 2. Bottle visibility check
    if (quality.bottle_visible === false) {
      return {
        text: '🔍 ไม่พบขวดน้ำในกรอบกล้อง',
        subtext: 'กรุณานำขวดน้ำเข้ามาให้อยู่ในกรอบเส้นประสีฟ้า',
        tone: 'info',
        readyToCapture: false,
      }
    }

    // 3. Label visibility check (prompt to rotate)
    if (quality.label_visible === false || reason === 'label_not_visible') {
      return {
        text: '🔄 หมุนขวดช้าๆ เพื่อหาหน้าฉลาก',
        subtext: 'พบตัวขวดแล้ว กำลังมองหาบริเวณฉลากสินค้า',
        tone: 'warning',
        readyToCapture: false,
      }
    }

    // 4. Orientation / framing boundary check
    if (reason === 'orientation_failed') {
      return {
        text: '📐 ปรับตำแหน่งขวดให้อยู่ในกรอบ',
        subtext: 'ขวดอยู่ชิดขอบเกินไปหรือถูกบังบางส่วน',
        tone: 'warning',
        readyToCapture: false,
      }
    }

    // 5. Success: Usable view found!
    if (usable_view) {
      return {
        text: '✨ พบฉลากชัดเจนแล้ว พร้อมถ่าย!',
        subtext: 'ตำแหน่งและคุณภาพภาพดี กดปุ่มถ่ายภาพเพื่อตรวจสอบได้ทันที',
        tone: 'success',
        readyToCapture: true,
      }
    }

    return {
      text: 'กำลังค้นหาฉลาก...',
      subtext: 'ถือขวดน้ำให้อยู่กึ่งกลางกรอบกล้อง',
      tone: 'info',
      readyToCapture: false,
    }
  }

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
        const thumbnailBlob = await captureThumbnail(video, 480, 0.8)

        if (!isSubscribed || abortController.signal.aborted) {
          return
        }

        const result = dataSource
          ? await dataSource.locateLabel(thumbnailBlob, expectedProduct, abortController.signal)
          : await locateLabel(thumbnailBlob, expectedProduct, abortController.signal)

        if (isSubscribed && !abortController.signal.aborted) {
          setLocateResult(result)
          setGuidance(computeGuidance(result))
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
