import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraDevice, CameraStatus } from './types'

export interface UseWebcamStreamOptions {
  autoStart?: boolean
  preferredDeviceId?: string
  width?: number
  height?: number
}

/**
 * Robust webcam stream hook conforming to rule 6 (04-3):
 * - Uses request generation token to cancel / discard stale in-flight getUserMedia requests
 * - Prevents orphaned media tracks and hardware lock (turns camera LED off cleanly)
 * - Decouples activeDeviceId state changes from camera lifecycle to avoid cyclic stream tear-downs
 * - Immediately terminates tracks if unmounted while getUserMedia is awaiting permission
 */
export function useWebcamStream(options: UseWebcamStreamOptions = {}) {
  const { autoStart = false, preferredDeviceId, width = 1280, height = 720 } = options

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const isMountedRef = useRef<boolean>(true)
  const requestGenRef = useRef<number>(0)
  const activeDeviceIdRef = useRef<string | null>(preferredDeviceId || null)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(preferredDeviceId || null)
  const [isMirrored, setIsMirrored] = useState<boolean>(true)

  // Keep activeDeviceIdRef in sync with state
  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId
  }, [activeDeviceId])

  /**
   * Stop all active media tracks cleanly to release hardware lock (camera LED turns off)
   * Also increments request generation token to invalidate any pending in-flight getUserMedia requests
   */
  const stopCamera = useCallback(() => {
    // Invalidate any in-flight requests immediately
    requestGenRef.current += 1

    if (streamRef.current) {
      const tracks = streamRef.current.getTracks()
      for (const track of tracks) {
        track.stop()
      }
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    if (isMountedRef.current) {
      setStatus('idle')
      setError(null)
    }
  }, [])

  /**
   * Enumerate available video input devices
   */
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      if (!isMountedRef.current) return

      const videoDevices = allDevices
        .filter((d) => d.kind === 'videoinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `กล้อง ${index + 1}`,
        }))

      setDevices(videoDevices)

      // If active device is missing or invalid, select the first one
      if (videoDevices.length > 0) {
        setActiveDeviceId((prev) => {
          if (prev && videoDevices.some((d) => d.deviceId === prev)) {
            return prev
          }
          const fallback = videoDevices[0].deviceId
          activeDeviceIdRef.current = fallback
          return fallback
        })
      }
    } catch (err) {
      console.warn('Failed to enumerate media devices:', err)
    }
  }, [])

  /**
   * Format human-friendly error messages in Thai
   */
  const formatMediaError = (err: any): string => {
    const errName = err?.name || ''
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      return 'เบราว์เซอร์ไม่ได้รับอนุญาตให้เข้าถึงกล้อง กรุณากดอนุญาตสิทธิ์การใช้งานกล้องในการตั้งค่า'
    }
    if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      return 'ไม่พบอุปกรณ์กล้องบนเครื่อง กรุณาเชื่อมต่อเว็บแคมแล้วลองใหม่อีกครั้ง'
    }
    if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      return 'กล้องกำลังถูกใช้งานโดยแอปพลิเคชันอื่น กรุณาปิดโปรแกรมอื่นที่ใช้กล้องแล้วลองใหม่'
    }
    if (errName === 'OverconstrainedError') {
      return 'กล้องไม่รองรับความละเอียดหรือเงื่อนไขที่ร้องขอ กำลังปรับลดคุณภาพเพื่อเชื่อมต่อ'
    }
    return err?.message || 'เกิดข้อผิดพลาดในการเปิดกล้อง'
  }

  /**
   * Request camera permission and start video stream using generation token
   */
  const startCamera = useCallback(
    async (deviceId?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (isMountedRef.current) {
          setError('เบราว์เซอร์ของคุณไม่รองรับ MediaDevices API')
          setStatus('error')
        }
        return
      }

      // Generate a new request token: any prior in-flight request is now superseded
      const currentGen = ++requestGenRef.current

      // Stop previous stream tracks cleanly before starting new request
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks()
        for (const track of tracks) {
          track.stop()
        }
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

      setStatus('requesting')
      setError(null)

      const targetDeviceId = deviceId || activeDeviceIdRef.current

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: targetDeviceId
          ? {
              deviceId: { exact: targetDeviceId },
              width: { ideal: width },
              height: { ideal: height },
            }
          : {
              facingMode: 'user',
              width: { ideal: width },
              height: { ideal: height },
            },
      }

      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (initialErr: any) {
          // If request was superseded while waiting for prompt, stop here
          if (requestGenRef.current !== currentGen || !isMountedRef.current) {
            return
          }
          // If exact constraint failed, fallback to generic video
          if (targetDeviceId && initialErr?.name === 'OverconstrainedError') {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: true,
            })
          } else {
            throw initialErr
          }
        }

        // CRITICAL CHECK: Has user cancelled or switched cameras while waiting for getUserMedia?
        if (requestGenRef.current !== currentGen || !isMountedRef.current) {
          // Stale stream! Stop all tracks immediately to prevent hardware lock
          for (const track of stream.getTracks()) {
            track.stop()
          }
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch (playErr) {
            console.warn('Video play interrupted or muted autoplay required:', playErr)
          }
        }

        // Secondary check in case play() resolution took time and component unmounted
        if (requestGenRef.current !== currentGen || !isMountedRef.current) {
          for (const track of stream.getTracks()) {
            track.stop()
          }
          streamRef.current = null
          return
        }

        setStatus('streaming')
        setError(null)

        // Refresh device list to capture actual device labels now that permission is granted
        await refreshDevices()

        // Sync active device ID from stream tracks
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          const trackSettings = videoTrack.getSettings()
          if (trackSettings.deviceId && trackSettings.deviceId !== activeDeviceIdRef.current) {
            activeDeviceIdRef.current = trackSettings.deviceId
            setActiveDeviceId(trackSettings.deviceId)
          }
        }
      } catch (err: any) {
        // If request was superseded, do not overwrite status with error
        if (requestGenRef.current !== currentGen || !isMountedRef.current) {
          return
        }
        console.error('getUserMedia error:', err)
        setStatus('error')
        setError(formatMediaError(err))
      }
    },
    [height, refreshDevices, width]
  )

  /**
   * Switch active camera device cleanly
   */
  const switchCamera = useCallback(
    async (newDeviceId: string) => {
      activeDeviceIdRef.current = newDeviceId
      setActiveDeviceId(newDeviceId)
      await startCamera(newDeviceId)
    },
    [startCamera]
  )

  /**
   * Toggle mirror preview
   */
  const toggleMirror = useCallback(() => {
    setIsMirrored((prev) => !prev)
  }, [])

  // Auto-start and device change listener lifecycle (isolated from activeDeviceId changes)
  useEffect(() => {
    isMountedRef.current = true

    if (autoStart) {
      startCamera()
    }
    refreshDevices()

    const handleDeviceChange = () => {
      refreshDevices()
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    }

    // Cleanup tracks unconditionally on unmount
    return () => {
      isMountedRef.current = false
      requestGenRef.current += 1

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop()
        }
        streamRef.current = null
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
      }
    }
  }, [autoStart, refreshDevices, startCamera])

  return {
    videoRef,
    stream: streamRef.current,
    status,
    error,
    devices,
    activeDeviceId,
    isMirrored,
    startCamera,
    stopCamera,
    switchCamera,
    toggleMirror,
    refreshDevices,
    isStreaming: status === 'streaming',
  }
}
