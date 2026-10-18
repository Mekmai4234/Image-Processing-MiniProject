import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraDevice, CameraStatus } from './types'

export interface UseWebcamStreamOptions {
  autoStart?: boolean
  preferredDeviceId?: string
  width?: number
  height?: number
}

export function useWebcamStream(options: UseWebcamStreamOptions = {}) {
  const { autoStart = false, preferredDeviceId, width = 1280, height = 720 } = options

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(preferredDeviceId || null)
  const [isMirrored, setIsMirrored] = useState<boolean>(true)

  /**
   * Stop all active media tracks cleanly to release hardware lock (camera LED turns off)
   */
  const stopCamera = useCallback(() => {
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

    setStatus('idle')
    setError(null)
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
          return videoDevices[0].deviceId
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
   * Request camera permission and start video stream
   */
  const startCamera = useCallback(
    async (deviceId?: string) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('เบราว์เซอร์ของคุณไม่รองรับ MediaDevices API')
        setStatus('error')
        return
      }

      // Stop any existing tracks first to avoid double-stream lock
      stopCamera()

      setStatus('requesting')
      setError(null)

      const targetDeviceId = deviceId || activeDeviceId

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

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch (playErr) {
            console.warn('Video play interrupted or muted autoplay required:', playErr)
          }
        }

        setStatus('streaming')
        setError(null)

        // Refresh device list to capture actual labels now that permission was granted
        await refreshDevices()

        // Sync active device ID from stream tracks if possible
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          const settings = videoTrack.getSettings()
          if (settings.deviceId) {
            setActiveDeviceId(settings.deviceId)
          }
        }
      } catch (err: any) {
        console.error('getUserMedia error:', err)
        setStatus('error')
        setError(formatMediaError(err))
      }
    },
    [activeDeviceId, height, refreshDevices, stopCamera, width]
  )

  /**
   * Switch active camera device
   */
  const switchCamera = useCallback(
    async (newDeviceId: string) => {
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

  // Auto-start if requested
  useEffect(() => {
    if (autoStart) {
      startCamera()
    }
    refreshDevices()

    // Listen for device change (e.g. plugging in or unplugging a USB webcam)
    const handleDeviceChange = () => {
      refreshDevices()
    }

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    }

    // Cleanup tracks on unmount
    return () => {
      stopCamera()
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
      }
    }
  }, [autoStart, refreshDevices, startCamera, stopCamera])

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
