import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  FlipHorizontal,
  HardDrive,
  Info,
  Layers,
  Play,
  RefreshCw,
  Sparkles,
  Video,
  VideoOff,
  XCircle,
  Zap,
} from 'lucide-react'
import type { DataSource } from '../../lib/dataSource'
import { liveDataSource } from '../../lib/dataSource'
import { useAppData } from '../../lib/AppData'
import type { InspectionRequest, InspectionResult, Product } from '../../types/inspection'
import { captureVideoFrame, generateClientRequestId } from './captureUtils'
import { useLabelLocator } from './useLabelLocator'
import { useWebcamStream } from './useWebcamStream'
import type { AutoCapturePhase, CameraPanelProps } from './types'
import { DwellTimer } from './dwellTimer'
import './CameraPanel.css'

export const CameraPanel: React.FC<CameraPanelProps> = ({
  dataSource,
  sourceKind = 'live',
  products: propProducts,
  expectedProduct = 'bottle_a',
  onProductChange,
  onInspectionComplete,
  autoLocate = true,
  className = '',
}) => {
  const appData = useAppData()
  const effectiveDs: DataSource = dataSource ?? liveDataSource
  const productCatalog: Product[] = propProducts ?? appData?.products ?? []

  // 1. Camera stream hook (proper permission & track cleanup)
  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    devices,
    activeDeviceId,
    isMirrored,
    startCamera,
    stopCamera,
    switchCamera,
    toggleMirror,
    isStreaming,
  } = useWebcamStream({ autoStart: false })

  // 2. Real-time throttled locator hook
  const { locateResult, guidance, isLocating } = useLabelLocator({
    videoRef,
    isStreaming,
    expectedProduct,
    enabled: autoLocate,
    intervalMs: 600,
    dataSource: effectiveDs,
    sourceKind,
  })

  // State
  const [selectedProduct, setSelectedProduct] = useState<string>(expectedProduct)
  const [isCapturing, setIsCapturing] = useState<boolean>(false)
  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null)
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'live' | 'frozen'>('live')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false)
  const [activeImageTab, setActiveImageTab] = useState<'annotated' | 'original'>('annotated')

  // Auto-capture states (Module 04-B)
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState<boolean>(false)
  const [autoPhase, setAutoPhase] = useState<AutoCapturePhase>('idle')
  const [dwellProgress, setDwellProgress] = useState<number>(0) // 0 to 100%

  const captureSeqRef = useRef<number>(0)
  const captureAbortRef = useRef<AbortController | null>(null)
  const frozenObjectUrlRef = useRef<string | null>(null)
  const bottleAbsentCountRef = useRef<number>(0)
  const lastFailedRequestRef = useRef<InspectionRequest | null>(null)

  // Dwell timer controller with generation token invalidation (17-1 & 17-2)
  const handleCaptureRef = useRef<((token?: number) => Promise<void>) | null>(null)
  const dwellTimerRef = useRef<DwellTimer | null>(null)
  if (!dwellTimerRef.current) {
    dwellTimerRef.current = new DwellTimer({
      dwellMs: 800,
      tickIntervalMs: 50,
      onProgress: (p) => setDwellProgress(p),
      onComplete: (token) => {
        setAutoPhase('inspecting')
        void handleCaptureRef.current?.(token)
      },
    })
  }

  // Discard in-flight requests and clear inspection results when source switches (17-1)
  useEffect(() => {
    dwellTimerRef.current?.invalidate()
    bottleAbsentCountRef.current = 0
    lastFailedRequestRef.current = null
    captureSeqRef.current++
    captureAbortRef.current?.abort()
    captureAbortRef.current = null
    setIsCapturing(false)
    setInspectionResult(null)
    setCaptureError(null)
    if (frozenObjectUrlRef.current) {
      URL.revokeObjectURL(frozenObjectUrlRef.current)
      frozenObjectUrlRef.current = null
    }
    setFrozenFrameUrl(null)
    setViewMode('live')
    setAutoPhase('idle')
  }, [dataSource, sourceKind])

  useEffect(() => {
    return () => {
      dwellTimerRef.current?.invalidate()
      captureSeqRef.current++
      captureAbortRef.current?.abort()
      if (frozenObjectUrlRef.current) {
        URL.revokeObjectURL(frozenObjectUrlRef.current)
      }
    }
  }, [])

  // Keep selected product in sync with prop if changed from outside
  useEffect(() => {
    setSelectedProduct(expectedProduct)
    dwellTimerRef.current?.invalidate()
  }, [expectedProduct])

  const handleProductSelect = (prodId: string) => {
    setSelectedProduct(prodId)
    lastFailedRequestRef.current = null
    setCaptureError(null)
    dwellTimerRef.current?.invalidate()
    if (autoCaptureEnabled && autoPhase === 'holding') {
      setAutoPhase('waiting_bottle')
    }
    onProductChange?.(prodId)
  }

  // 3. Core capture and submit handler
  const handleCaptureAndInspect = useCallback(
    async (triggeredToken?: number) => {
      const dwell = dwellTimerRef.current
      if (triggeredToken !== undefined && dwell && !dwell.isTokenValid(triggeredToken)) {
        return
      }

      const video = videoRef.current
      if (!video || !isStreaming || isCapturing) return

      const sessionTokenSnapshot = dwell?.token ?? 0
      const seq = ++captureSeqRef.current
      captureAbortRef.current?.abort()
      const abortCtrl = new AbortController()
      captureAbortRef.current = abortCtrl

      setIsCapturing(true)
      setCaptureError(null)

      // Trigger visual shutter flash
      setIsFlashActive(true)
      setTimeout(() => setIsFlashActive(false), 220)

      let currentReq: InspectionRequest | null = null

      try {
        // Capture at real video dimensions
        const frame = await captureVideoFrame(video, 'image/jpeg', 0.92)

        if (
          (dwell && !dwell.isTokenValid(sessionTokenSnapshot)) ||
          seq !== captureSeqRef.current ||
          abortCtrl.signal.aborted
        ) {
          return
        }

        const clientRequestId = generateClientRequestId()

        // Create frozen frame URL to preview immediately
        if (frozenObjectUrlRef.current) {
          URL.revokeObjectURL(frozenObjectUrlRef.current)
        }
        const frozenUrl = URL.createObjectURL(frame.blob)
        frozenObjectUrlRef.current = frozenUrl
        setFrozenFrameUrl(frozenUrl)
        setViewMode('frozen')

        if (
          (dwell && !dwell.isTokenValid(sessionTokenSnapshot)) ||
          seq !== captureSeqRef.current ||
          abortCtrl.signal.aborted
        ) {
          return
        }

        const inspectionReq: InspectionRequest = {
          image: frame.blob,
          imageName: 'webcam-capture.jpg',
          expected_product: selectedProduct,
          source_mode: 'webcam',
          client_request_id: clientRequestId,
          demo: sourceKind === 'demo',
        }
        currentReq = inspectionReq

        const result = await effectiveDs.createInspection(inspectionReq, abortCtrl.signal)

        if (
          (dwell && !dwell.isTokenValid(sessionTokenSnapshot)) ||
          seq !== captureSeqRef.current ||
          abortCtrl.signal.aborted
        ) {
          return
        }

        lastFailedRequestRef.current = null
        setCaptureError(null)
        setInspectionResult(result)
        onInspectionComplete?.(result)

        if (autoCaptureEnabled) {
          setAutoPhase('awaiting_removal')
        }
      } catch (err: any) {
        if (
          (dwell && !dwell.isTokenValid(sessionTokenSnapshot)) ||
          seq !== captureSeqRef.current ||
          abortCtrl.signal.aborted
        ) {
          return
        }
        console.error('Inspection error:', err)
        lastFailedRequestRef.current = currentReq
        setCaptureError(err?.message || 'เกิดข้อผิดพลาดในการตรวจสอบภาพ')
        if (autoCaptureEnabled) {
          setAutoPhase('waiting_bottle')
        }
      } finally {
        if (seq === captureSeqRef.current) {
          setIsCapturing(false)
        }
      }
    },
    [autoCaptureEnabled, effectiveDs, isCapturing, isStreaming, onInspectionComplete, selectedProduct, sourceKind, videoRef],
  )

  // Retry last failed inspection reusing the identical client_request_id and payload
  const handleRetryLastInspection = useCallback(async () => {
    const failedReq = lastFailedRequestRef.current
    if (!failedReq || isCapturing) return

    const seq = ++captureSeqRef.current
    captureAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    captureAbortRef.current = abortCtrl

    setIsCapturing(true)
    setCaptureError(null)

    try {
      const result = await effectiveDs.createInspection(failedReq, abortCtrl.signal)

      if (seq !== captureSeqRef.current || abortCtrl.signal.aborted) {
        return
      }

      lastFailedRequestRef.current = null
      setCaptureError(null)
      setInspectionResult(result)
      onInspectionComplete?.(result)

      if (autoCaptureEnabled) {
        setAutoPhase('awaiting_removal')
      }
    } catch (err: any) {
      if (seq !== captureSeqRef.current || abortCtrl.signal.aborted) {
        return
      }
      console.error('Inspection retry error:', err)
      setCaptureError(err?.message || 'เกิดข้อผิดพลาดในการตรวจสอบภาพ')
      if (autoCaptureEnabled) {
        setAutoPhase('waiting_bottle')
      }
    } finally {
      if (seq === captureSeqRef.current) {
        setIsCapturing(false)
      }
    }
  }, [autoCaptureEnabled, effectiveDs, isCapturing, onInspectionComplete])

  handleCaptureRef.current = handleCaptureAndInspect

  // 4. Auto-capture State Machine (Module 04-B / 17-1 / 17-2)
  useEffect(() => {
    const dwell = dwellTimerRef.current
    if (!dwell) return

    if (!autoCaptureEnabled || !isStreaming) {
      dwell.cancel()
      setAutoPhase('idle')
      bottleAbsentCountRef.current = 0
      return
    }

    // Phase: awaiting_removal -> wait for user to take bottle out or press next
    if (autoPhase === 'awaiting_removal') {
      const bottleSeen = locateResult?.quality?.bottle_visible || locateResult?.usable_view
      if (!bottleSeen) {
        bottleAbsentCountRef.current++
        if (bottleAbsentCountRef.current >= 2) {
          // Bottle was removed for >= 2 locator ticks, ready for next bottle!
          setAutoPhase('waiting_bottle')
          setViewMode('live')
          dwell.cancel()
          bottleAbsentCountRef.current = 0
        }
      } else {
        bottleAbsentCountRef.current = 0
      }
      return
    }

    if (autoPhase === 'inspecting' || isCapturing) {
      return
    }

    // Check if view is usable
    const isUsable = Boolean(locateResult?.usable_view)

    if (!isUsable) {
      // Bottle not ready or lost focus -> cancel dwell and reset to waiting
      dwell.cancel()
      if (autoPhase !== 'waiting_bottle') {
        setAutoPhase('waiting_bottle')
      }
      return
    }

    // Bottle is usable -> start dwell countdown (800ms) if not already running
    if (!dwell.hasStarted) {
      setAutoPhase('holding')
      dwell.start()
    }
  }, [autoCaptureEnabled, autoPhase, isCapturing, isStreaming, locateResult])

  // Return to live camera stream / Next bottle (Manual bypass)
  const handleReturnToLive = () => {
    dwellTimerRef.current?.cancel()
    bottleAbsentCountRef.current = 0
    lastFailedRequestRef.current = null
    setCaptureError(null)
    setViewMode('live')
    if (autoCaptureEnabled) {
      setAutoPhase('waiting_bottle')
    }
  }

  // Compute scaled bounding box for overlay HUD
  const renderBoundingBoxOverlay = () => {
    if (!locateResult?.bbox || !videoRef.current) return null

    const video = videoRef.current
    const clientW = video.clientWidth
    const clientH = video.clientHeight
    const imgW = locateResult.image_width || video.videoWidth || 640
    const imgH = locateResult.image_height || video.videoHeight || 480

    if (!clientW || !clientH) return null

    const scale = Math.max(clientW / imgW, clientH / imgH)
    const offsetX = (clientW - imgW * scale) / 2
    const offsetY = (clientH - imgH * scale) / 2

    const rawBox = locateResult.bbox
    let boxX = rawBox.x * scale + offsetX
    const boxY = rawBox.y * scale + offsetY
    const boxW = rawBox.width * scale
    const boxH = rawBox.height * scale

    if (isMirrored) {
      boxX = clientW - (boxX + boxW)
    }

    const strokeColor = locateResult.usable_view ? '#10b981' : '#f59e0b'
    const fillColor = locateResult.usable_view ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)'

    return (
      <svg className="locator-bbox-svg" viewBox={`0 0 ${clientW} ${clientH}`}>
        <rect
          x={boxX}
          y={boxY}
          width={boxW}
          height={boxH}
          rx={6}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={2}
          strokeDasharray={locateResult.usable_view ? 'none' : '6 4'}
        />
        <text
          x={boxX + 8}
          y={Math.max(boxY - 8, 20)}
          fill={strokeColor}
          fontSize={12}
          fontWeight={700}
          fontFamily="Inter, sans-serif"
        >
          {locateResult.usable_view ? '✓ ฉลากพร้อมตรวจ' : 'กำลังค้นหาฉลาก'}
        </text>
      </svg>
    )
  }

  // Determine current active step (0: Position, 1: Rotate, 2: Hold, 3: Capture)
  const currentStepIndex = !isStreaming
    ? 0
    : isCapturing || viewMode === 'frozen'
    ? 3
    : autoPhase === 'holding'
    ? 2
    : locateResult?.usable_view
    ? 2
    : locateResult?.quality?.bottle_visible
    ? 1
    : 0

  return (
    <div className={`camera-panel-container ${className}`}>
      {/* Top 4-Step Guidance Ribbon */}
      <div className="webcam-step-ribbon">
        <div className={`step-item ${currentStepIndex === 0 ? 'active' : currentStepIndex > 0 ? 'completed' : ''}`}>
          <span className="step-num">1</span>
          <span className="step-text">วางขวดในตำแหน่ง</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStepIndex === 1 ? 'active' : currentStepIndex > 1 ? 'completed' : ''}`}>
          <span className="step-num">2</span>
          <span className="step-text">หมุนช้า ๆ หาฉลาก</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStepIndex === 2 ? 'active' : currentStepIndex > 2 ? 'completed' : ''}`}>
          <span className="step-num">3</span>
          <span className="step-text">ถือนิ่ง (Hold)</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStepIndex === 3 ? 'active' : ''}`}>
          <span className="step-num">4</span>
          <span className="step-text">ถ่ายและตรวจ (Capture)</span>
        </div>
      </div>

      {/* Main Grid: Left 2/3 (Camera Viewport), Right 1/3 (Controls & Info) */}
      <div className="camera-layout-grid">
        {/* Left Column: Viewport (Live or Frozen Result) */}
        <div className="camera-viewport-card">
          {/* Card Header & Controls */}
          <div className="camera-card-header">
            <div className="camera-card-title">
              <Camera className="w-5 h-5 text-cyan-400" />
              <span>Webcam Inspection</span>
              <span className={`camera-status-pill status-pill-${cameraStatus}`}>
                <span className="status-dot-pulse" />
                {cameraStatus === 'streaming'
                  ? viewMode === 'frozen'
                    ? 'ผลตรวจ (Frozen)'
                    : 'กำลังถ่ายทอดสด'
                  : cameraStatus === 'requesting'
                  ? 'กำลังขอสิทธิ์...'
                  : cameraStatus === 'error'
                  ? 'ข้อผิดพลาด'
                  : 'ปิดกล้อง'}
              </span>
            </div>

            <div className="camera-toolbar-right">
              {/* View Switcher if frozen frame exists */}
              {frozenFrameUrl && isStreaming && (
                <div className="view-mode-toggle">
                  <button
                    type="button"
                    className={`btn-toggle-view ${viewMode === 'live' ? 'active' : ''}`}
                    onClick={() => setViewMode('live')}
                    title="ดูกล้องสด"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>สด (Live)</span>
                  </button>
                  <button
                    type="button"
                    className={`btn-toggle-view ${viewMode === 'frozen' ? 'active' : ''}`}
                    onClick={() => setViewMode('frozen')}
                    title="ดูภาพผลตรวจที่ตรึงไว้"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>ผลตรวจ</span>
                  </button>
                </div>
              )}

              {/* Device Selector */}
              {devices.length > 0 && isStreaming && (
                <select
                  className="device-select"
                  value={activeDeviceId || ''}
                  onChange={(e) => switchCamera(e.target.value)}
                  aria-label="เลือกอุปกรณ์กล้อง"
                >
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Mirror Toggle */}
              {isStreaming && (
                <button
                  type="button"
                  className={`btn-tool ${isMirrored ? 'active' : ''}`}
                  onClick={toggleMirror}
                  title="กลับด้านภาพ (Mirror Preview)"
                >
                  <FlipHorizontal className="w-4 h-4" />
                </button>
              )}

              {/* Power Toggle Button */}
              {isStreaming ? (
                <button
                  type="button"
                  className="btn-tool active btn-power-off"
                  onClick={stopCamera}
                  title="ปิดกล้องและคืนทรัพยากร"
                >
                  <VideoOff className="w-4 h-4 text-red-400" />
                  <span>ปิดกล้อง</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-tool active btn-power-on"
                  onClick={() => startCamera()}
                  title="เปิดกล้องเว็บแคม"
                >
                  <Video className="w-4 h-4 text-cyan-400" />
                  <span>เปิดกล้อง</span>
                </button>
              )}
            </div>
          </div>

          {/* Viewport Frame */}
          <div className="camera-viewport-wrap">
            {/* Shutter Flash Animation */}
            <div className={`camera-flash-overlay ${isFlashActive ? 'active' : ''}`} />

            {/* Live Video */}
            <video
              ref={videoRef}
              className={`camera-video ${isMirrored ? 'mirrored' : ''} ${viewMode === 'frozen' ? 'hidden' : ''}`}
              autoPlay
              playsInline
              muted
            />

            {/* Frozen Capture Frame (Rule 04-A: Separate Live preview from Frozen Result) */}
            {viewMode === 'frozen' && frozenFrameUrl && (
              <div className="frozen-viewport-container">
                <img
                  src={
                    activeImageTab === 'annotated' && inspectionResult?.images?.annotated
                      ? effectiveDs.imageUrl(inspectionResult, 'annotated') || frozenFrameUrl
                      : frozenFrameUrl
                  }
                  alt="Captured inspection frame"
                  className="camera-video frozen-frame-img"
                />
                <div className="frozen-banner-overlay">
                  <span className="frozen-label">ภาพผลตรวจ (Captured Frame)</span>
                  <button type="button" className="btn-resume-live" onClick={handleReturnToLive}>
                    <Play className="w-3.5 h-3.5" />
                    <span>กลับไปที่กล้องสด (Next Bottle)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Placeholder Screen when camera is off */}
            {!isStreaming && (
              <div className="camera-placeholder-screen">
                {cameraStatus === 'error' ? (
                  <>
                    <AlertCircle className="camera-placeholder-icon text-red-400" />
                    <div className="font-semibold text-red-300 text-base">ไม่สามารถเปิดกล้องได้</div>
                    <div className="camera-placeholder-text">{cameraError}</div>
                    <button
                      type="button"
                      className="btn-primary-capture mt-2"
                      onClick={() => startCamera()}
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>ลองใหม่อีกครั้ง</span>
                    </button>
                  </>
                ) : (
                  <>
                    <VideoOff className="camera-placeholder-icon" />
                    <div className="font-semibold text-slate-300 text-base">กล้องปิดอยู่</div>
                    <div className="camera-placeholder-text">
                      กดปุ่ม <strong>"เปิดกล้อง"</strong> เพื่อเริ่มการสแกนฉลากขวดแบบเรียลไทม์
                    </div>
                    <button
                      type="button"
                      className="btn-primary-capture mt-2"
                      onClick={() => startCamera()}
                    >
                      <Video className="w-4 h-4" />
                      <span>เปิดกล้องเว็บแคม</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* HUD Overlay when streaming in live mode */}
            {isStreaming && viewMode === 'live' && (
              <div className="camera-hud-overlay">
                {/* Central Target Guide */}
                <div className={`camera-target-guide ${guidance.readyToCapture ? 'ready' : ''}`}>
                  <div className="guide-corner corner-tl" />
                  <div className="guide-corner corner-tr" />
                  <div className="guide-corner corner-bl" />
                  <div className="guide-corner corner-br" />
                </div>

                {/* Dynamic BBox from Locator */}
                {renderBoundingBoxOverlay()}

                {/* Floating Guidance Banner */}
                <div className={`camera-guidance-banner guidance-tone-${guidance.tone}`}>
                  {guidance.tone === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : guidance.tone === 'warning' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <Info className="w-5 h-5 text-cyan-400 shrink-0" />
                  )}
                  <div className="guidance-content">
                    <span className="guidance-title">{guidance.text}</span>
                    <span className="guidance-subtext">{guidance.subtext}</span>
                  </div>
                  {isLocating && <RefreshCw className="w-3.5 h-3.5 animate-spin ml-2 text-cyan-400 opacity-75" />}
                </div>

                {/* Dwell Progress Bar for Auto-capture */}
                {autoCaptureEnabled && autoPhase === 'holding' && (
                  <div className="dwell-progress-container">
                    <div className="dwell-progress-bar" style={{ width: `${dwellProgress}%` }} />
                    <span className="dwell-progress-text">กำลังตรวจนิ่ง... {dwellProgress}%</span>
                  </div>
                )}

                {/* Resolution Badge */}
                <div className="camera-resolution-badge">
                  {videoRef.current?.videoWidth ? `${videoRef.current.videoWidth} × ${videoRef.current.videoHeight}px` : 'LIVE'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Controls, Product Select & Auto-capture */}
        <div className="camera-controls-column">
          {/* Target Product Selection (from real catalog) */}
          <div className="control-panel-card">
            <h3 className="control-card-title">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>สินค้าที่คาดหวัง (Expected Product)</span>
            </h3>

            <div className="product-options-list">
              {productCatalog.length > 0 ? (
                productCatalog.map((p) => (
                  <button
                    key={p.product_id}
                    type="button"
                    className={`product-card-btn ${selectedProduct === p.product_id ? 'active' : ''}`}
                    onClick={() => handleProductSelect(p.product_id)}
                  >
                    <span className="product-btn-name">{p.display_name}</span>
                    <span className="product-btn-id">{p.product_id}</span>
                  </button>
                ))
              ) : (
                <div className="text-slate-400 text-xs">กำลังโหลดรายการสินค้า...</div>
              )}
            </div>
          </div>

          {/* Auto Capture & Continuous Inspection Mode (04-B) */}
          <div className="control-panel-card">
            <div className="flex items-center justify-between">
              <h3 className="control-card-title mb-0">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>ตรวจอัตโนมัติ (Auto-Capture)</span>
              </h3>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoCaptureEnabled}
                  onChange={(e) => setAutoCaptureEnabled(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <p className="control-card-desc">
              เมื่อเปิดใช้งาน ระบบจะตรวจจับภาพนิ่งต่อเนื่องและถ่ายส่งตรวจทันทีเมื่อพบฉลากชัดเจน
            </p>

            {autoCaptureEnabled && (
              <div className={`auto-phase-badge phase-${autoPhase}`}>
                {autoPhase === 'waiting_bottle' && 'รอตรวจพบขวด...'}
                {autoPhase === 'holding' && `ถือนิ่ง (${dwellProgress}%)`}
                {autoPhase === 'inspecting' && 'กำลังตรวจวิเคราะห์...'}
                {autoPhase === 'awaiting_removal' && 'ตรวจเสร็จแล้ว: นำขวดออกเพื่อเริ่มขวดใหม่'}
                {autoPhase === 'idle' && 'พร้อมทำงาน'}
              </div>
            )}
          </div>

          {/* Trigger Capture Button */}
          <div className="control-panel-card capture-action-card">
            {captureError && (
              <div className="capture-error-box">
                <div className="capture-error-message">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{captureError}</span>
                </div>
                {lastFailedRequestRef.current && (
                  <button
                    type="button"
                    className="btn-retry-capture"
                    onClick={() => void handleRetryLastInspection()}
                    disabled={isCapturing}
                    title="ส่งคำขอเดิมซ้ำด้วย client_request_id เดิม"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>ลองใหม่ (Retry ด้วย ID เดิม)</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              className={`btn-primary-capture ${guidance.readyToCapture ? 'highlight' : ''}`}
              onClick={() => void handleCaptureAndInspect()}
              disabled={!isStreaming || isCapturing}
              title="กดเพื่อถ่ายภาพและส่งตรวจความละเอียดจริง"
            >
              {isCapturing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>กำลังตรวจวิเคราะห์...</span>
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5" />
                  <span>ถ่ายภาพเพื่อตรวจ (Capture)</span>
                </>
              )}
            </button>

            {viewMode === 'frozen' && (
              <button
                type="button"
                className="btn-next-bottle mt-2"
                onClick={handleReturnToLive}
              >
                <Play className="w-4 h-4" />
                <span>ตรวจขวดถัดไป (Next Bottle)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Drawer: Latest Inspection Result Card */}
      {inspectionResult && (
        <div className="latest-result-card">
          <div className="result-header-row">
            <div className="flex items-center gap-3 flex-wrap">
              {(inspectionResult.demo || inspectionResult.is_demo) && (
                <span className="demo-badge-pill">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  DEMO MODE (จำลอง)
                </span>
              )}
              <span className={`result-verdict-tag verdict-${inspectionResult.result.toLowerCase()}`}>
                {inspectionResult.result === 'PASS' && <CheckCircle2 className="w-5 h-5" />}
                {inspectionResult.result === 'FAIL' && <XCircle className="w-5 h-5" />}
                {inspectionResult.result === 'REVIEW' && <AlertTriangle className="w-5 h-5" />}
                <span>{inspectionResult.result}</span>
              </span>
              <span className="result-reason-text">
                เหตุผล: <code>{inspectionResult.reason}</code>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="result-storage-tag">
                <HardDrive className="w-3.5 h-3.5" />
                บันทึก: <strong>{inspectionResult.storage_status}</strong>
              </span>
              <span className="result-storage-tag">
                <Clock className="w-3.5 h-3.5" />
                {inspectionResult.timing_ms.total} ms
              </span>
            </div>
          </div>

          {/* Key Facts Grid */}
          <div className="result-metrics-grid">
            <div className="metric-box">
              <span className="metric-label">สินค้าที่คาดหวัง</span>
              <span className="metric-value">{inspectionResult.expected_product}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">สินค้าที่ตรวจพบ</span>
              <span className="metric-value">{inspectionResult.detected_product || '—'}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">
                Match Score {inspectionResult.match_score !== null ? `(${Math.round(inspectionResult.match_score * 100)}%)` : ''}
              </span>
              <span className="metric-value font-mono">
                {inspectionResult.match_score !== null ? inspectionResult.match_score.toFixed(4) : '—'}
              </span>
              {inspectionResult.match_score !== null && (
                <div className="score-bar-bg">
                  <div
                    className="score-bar-fill"
                    style={{ width: `${Math.min(100, Math.max(0, inspectionResult.match_score * 100))}%` }}
                  />
                </div>
              )}
            </div>
            <div className="metric-box">
              <span className="metric-label">ขนาดภาพจริง</span>
              <span className="metric-value">
                {inspectionResult.image_width} × {inspectionResult.image_height} px
              </span>
            </div>
          </div>

          {/* Stored Images Switcher */}
          <div className="result-images-container">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                ภาพผลตรวจที่บันทึก
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn-img-tab ${activeImageTab === 'annotated' ? 'active' : ''}`}
                  onClick={() => setActiveImageTab('annotated')}
                >
                  ภาพมีกรอบตรวจ (Annotated)
                </button>
                <button
                  type="button"
                  className={`btn-img-tab ${activeImageTab === 'original' ? 'active' : ''}`}
                  onClick={() => setActiveImageTab('original')}
                >
                  ภาพต้นฉบับ (Original)
                </button>
              </div>
            </div>

            <div className="result-image-display-frame">
              {activeImageTab === 'annotated' && inspectionResult.images.annotated ? (
                <img
                  src={effectiveDs.imageUrl(inspectionResult, 'annotated') || ''}
                  alt="Annotated Inspection Result"
                />
              ) : inspectionResult.images.original ? (
                <img
                  src={effectiveDs.imageUrl(inspectionResult, 'original') || ''}
                  alt="Original Inspection Capture"
                />
              ) : (
                <div className="text-slate-400 text-sm py-8 text-center">กำลังจัดเก็บรูปภาพ...</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
