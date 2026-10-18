import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FlipHorizontal,
  HardDrive,
  Info,
  RefreshCw,
  Video,
  VideoOff,
  XCircle,
} from 'lucide-react'
import { resolveImageUrl, submitInspection } from '../../lib/api'
import type { InspectionResult } from '../../types/inspection'
import { captureVideoFrame, generateClientRequestId } from './captureUtils'
import { useLabelLocator } from './useLabelLocator'
import { useWebcamStream } from './useWebcamStream'
import type { CameraPanelProps } from './types'
import './CameraPanel.css'

export const CameraPanel: React.FC<CameraPanelProps> = ({
  expectedProduct = 'bottle_a',
  onProductChange,
  onInspectionComplete,
  autoLocate = true,
  className = '',
}) => {
  // 1. Camera stream hook (Rule 6.1, 6.7: proper permission & track cleanup)
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

  // 2. Real-time throttled locator hook (Rule 6.4, 6.5: max 1 in-flight, throttled feedback)
  const { locateResult, guidance, isLocating } = useLabelLocator({
    videoRef,
    isStreaming,
    expectedProduct,
    enabled: autoLocate,
    intervalMs: 600,
  })

  // Local state for capture and inspection
  const [selectedProduct, setSelectedProduct] = useState<string>(expectedProduct)
  const [isCapturing, setIsCapturing] = useState<boolean>(false)
  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [isFlashActive, setIsFlashActive] = useState<boolean>(false)
  const [activeImageTab, setActiveImageTab] = useState<'annotated' | 'original'>('annotated')

  // Keep selected product in sync with prop if changed from outside
  useEffect(() => {
    setSelectedProduct(expectedProduct)
  }, [expectedProduct])

  const handleProductSelect = (prodId: string) => {
    setSelectedProduct(prodId)
    onProductChange?.(prodId)
  }

  // 3. Capture & submit for inspection (Rule 6.2: Native video resolution, not CSS size)
  const handleCaptureAndInspect = useCallback(async () => {
    const video = videoRef.current
    if (!video || !isStreaming) return

    setIsCapturing(true)
    setCaptureError(null)

    // Trigger visual shutter flash
    setIsFlashActive(true)
    setTimeout(() => setIsFlashActive(false), 250)

    try {
      // Capture at real optical video dimensions
      const frame = await captureVideoFrame(video, 'image/jpeg', 0.92)
      const clientRequestId = generateClientRequestId()

      const result = await submitInspection({
        image: frame.blob,
        expectedProduct: selectedProduct,
        sourceMode: 'webcam',
        clientRequestId,
      })

      setInspectionResult(result)
      onInspectionComplete?.(result)
    } catch (err: any) {
      console.error('Inspection error:', err)
      setCaptureError(err?.message || 'เกิดข้อผิดพลาดในการตรวจสอบภาพ')
    } finally {
      setIsCapturing(false)
    }
  }, [isStreaming, onInspectionComplete, selectedProduct, videoRef])

  // Compute scaled bounding box for overlay HUD
  const renderBoundingBoxOverlay = () => {
    if (!locateResult?.bbox || !videoRef.current) return null

    const video = videoRef.current
    const clientW = video.clientWidth
    const clientH = video.clientHeight
    const imgW = locateResult.image_width || video.videoWidth || 640
    const imgH = locateResult.image_height || video.videoHeight || 480

    if (!clientW || !clientH) return null

    // Compute scale and letterbox offset for object-fit: cover
    const scale = Math.max(clientW / imgW, clientH / imgH)
    const offsetX = (clientW - imgW * scale) / 2
    const offsetY = (clientH - imgH * scale) / 2

    const rawBox = locateResult.bbox
    let boxX = rawBox.x * scale + offsetX
    const boxY = rawBox.y * scale + offsetY
    const boxW = rawBox.width * scale
    const boxH = rawBox.height * scale

    // Invert X when mirrored preview is active
    if (isMirrored) {
      boxX = clientW - (boxX + boxW)
    }

    const strokeColor = locateResult.usable_view ? '#10b981' : '#f59e0b'
    const fillColor = locateResult.usable_view ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'

    return (
      <svg className="locator-bbox-svg" viewBox={`0 0 ${clientW} ${clientH}`}>
        <rect
          x={boxX}
          y={boxY}
          width={boxW}
          height={boxH}
          rx={8}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={2.5}
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

  return (
    <div className={`camera-panel-container ${className}`}>
      {/* Main Camera Card */}
      <div className="camera-card">
        {/* Card Header & Controls */}
        <div className="camera-card-header">
          <div className="camera-card-title">
            <Camera className="w-5 h-5 text-blue-600" />
            <span>Webcam Live Inspection</span>
            <span className={`camera-status-pill status-pill-${cameraStatus}`}>
              <span className="status-dot-pulse" />
              {cameraStatus === 'streaming'
                ? 'กำลังถ่ายทอดสด'
                : cameraStatus === 'requesting'
                ? 'กำลังขอสิทธิ์...'
                : cameraStatus === 'error'
                ? 'ข้อผิดพลาด'
                : 'ปิดกล้อง'}
            </span>
          </div>

          <div className="camera-toolbar-right">
            {/* Device Switcher */}
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

            {/* Mirror Toggle Button */}
            {isStreaming && (
              <button
                type="button"
                className={`btn-tool ${isMirrored ? 'active' : ''}`}
                onClick={toggleMirror}
                title="กลับด้านภาพ (Mirror Preview)"
              >
                <FlipHorizontal className="w-4 h-4" />
                <span>กลับด้าน</span>
              </button>
            )}

            {/* Power / Toggle Button */}
            {isStreaming ? (
              <button
                type="button"
                className="btn-tool active"
                onClick={stopCamera}
                title="ปิดกล้องและคืนหน่วยความจำ"
              >
                <VideoOff className="w-4 h-4 text-red-500" />
                <span>ปิดกล้อง</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-tool active"
                onClick={() => startCamera()}
                title="เปิดกล้องเว็บแคม"
              >
                <Video className="w-4 h-4 text-emerald-600" />
                <span>เปิดกล้อง</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Viewport Area */}
        <div className="camera-viewport-wrap">
          {/* Shutter Flash Animation */}
          <div className={`camera-flash-overlay ${isFlashActive ? 'active' : ''}`} />

          {/* HTML5 Video Element */}
          <video
            ref={videoRef}
            className={`camera-video ${isMirrored ? 'mirrored' : ''}`}
            autoPlay
            playsInline
            muted
          />

          {/* Fallback Screen when camera is off or error */}
          {!isStreaming && (
            <div className="camera-placeholder-screen">
              {cameraStatus === 'error' ? (
                <>
                  <AlertCircle className="camera-placeholder-icon text-red-500" />
                  <div className="font-semibold text-red-600 text-base">ไม่สามารถเปิดกล้องได้</div>
                  <div className="camera-placeholder-text">{cameraError}</div>
                  <button
                    type="button"
                    className="btn-capture mt-2"
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
                    กดปุ่ม <strong>"เปิดกล้อง"</strong> เพื่อขอสิทธิ์เข้าถึงเว็บแคมและเริ่มระบบตรวจสอบฉลาก
                  </div>
                  <button
                    type="button"
                    className="btn-capture mt-2"
                    onClick={() => startCamera()}
                  >
                    <Video className="w-4 h-4" />
                    <span>เปิดกล้องเว็บแคม</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* HUD Overlay when streaming */}
          {isStreaming && (
            <div className="camera-hud-overlay">
              {/* Central Target Guide */}
              <div className={`camera-target-guide ${guidance.readyToCapture ? 'ready' : ''}`}>
                <div className="guide-corner corner-tl" />
                <div className="guide-corner corner-tr" />
                <div className="guide-corner corner-bl" />
                <div className="guide-corner corner-br" />
              </div>

              {/* Dynamic Bounding Box from Locator */}
              {renderBoundingBoxOverlay()}

              {/* Floating Dynamic Guidance Banner */}
              <div className={`camera-guidance-banner guidance-tone-${guidance.tone}`}>
                {guidance.tone === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : guidance.tone === 'warning' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                ) : (
                  <Info className="w-5 h-5 text-blue-400 shrink-0" />
                )}
                <div className="guidance-content">
                  <span className="guidance-title">{guidance.text}</span>
                  <span className="guidance-subtext">{guidance.subtext}</span>
                </div>
                {isLocating && <RefreshCw className="w-3.5 h-3.5 animate-spin ml-2 opacity-60" />}
              </div>

              {/* Resolution & Details Badge */}
              <div className="camera-resolution-badge">
                {videoRef.current?.videoWidth ? `${videoRef.current.videoWidth} × ${videoRef.current.videoHeight}px` : 'LIVE'}
              </div>
            </div>
          )}
        </div>

        {/* Action Controls Bar */}
        <div className="camera-actions-bar">
          {/* Product Selector */}
          <div className="product-selector-group">
            <span className="product-label">สินค้าที่ต้องการตรวจ:</span>
            <button
              type="button"
              className={`product-pill ${selectedProduct === 'bottle_a' ? 'active' : ''}`}
              onClick={() => handleProductSelect('bottle_a')}
            >
              น้ำดื่มขวด A (สิงห์ 600ml)
            </button>
            <button
              type="button"
              className={`product-pill ${selectedProduct === 'bottle_b' ? 'active' : ''}`}
              onClick={() => handleProductSelect('bottle_b')}
            >
              น้ำดื่มขวด B (คริสตัล 600ml)
            </button>
          </div>

          {/* Capture Trigger */}
          <div className="capture-controls">
            {captureError && (
              <span className="text-red-500 text-xs font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {captureError}
              </span>
            )}
            <button
              type="button"
              className={`btn-capture ${guidance.readyToCapture ? 'highlight' : ''}`}
              onClick={handleCaptureAndInspect}
              disabled={!isStreaming || isCapturing}
              title="จับภาพจากกล้องที่ความละเอียดจริงและส่งตรวจ"
            >
              {isCapturing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>กำลังตรวจวิเคราะห์...</span>
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  <span>ถ่ายภาพเพื่อตรวจ (Capture)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Inspection Result Drawer */}
      {inspectionResult && (
        <div className="inspection-result-card">
          <div className="result-header-row">
            <div className="flex items-center gap-3">
              <span className={`result-badge result-badge-${inspectionResult.result.toLowerCase()}`}>
                {inspectionResult.result === 'PASS' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {inspectionResult.result === 'FAIL' && <XCircle className="w-5 h-5 text-red-600" />}
                {inspectionResult.result === 'REVIEW' && <AlertTriangle className="w-5 h-5 text-amber-600" />}
                <span>{inspectionResult.result}</span>
              </span>
              <span className="text-sm font-semibold text-slate-700">
                เหตุผล: <code className="bg-slate-100 px-2 py-0.5 rounded text-blue-700">{inspectionResult.reason}</code>
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

          {/* Key Metrics Grid */}
          <div className="result-grid-info">
            <div className="result-field">
              <span className="result-field-label">สินค้าที่คาดหวัง</span>
              <span className="result-field-value">{inspectionResult.expected_product}</span>
            </div>
            <div className="result-field">
              <span className="result-field-label">สินค้าที่ตรวจพบ</span>
              <span className="result-field-value">{inspectionResult.detected_product || '—'}</span>
            </div>
            <div className="result-field">
              <span className="result-field-label">
                Match Score {inspectionResult.match_score !== null ? `(${Math.round(inspectionResult.match_score * 100)}%)` : ''}
              </span>
              <span className="result-field-value font-mono">
                {inspectionResult.match_score !== null ? inspectionResult.match_score.toFixed(4) : 'null'}
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
            <div className="result-field">
              <span className="result-field-label">ขนาดภาพต้นฉบับ</span>
              <span className="result-field-value">
                {inspectionResult.image_width} × {inspectionResult.image_height} px
              </span>
            </div>
          </div>

          {/* Image View Panel */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">ภาพผลตรวจ (Saved Images)</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn-tool ${activeImageTab === 'annotated' ? 'active' : ''}`}
                  onClick={() => setActiveImageTab('annotated')}
                >
                  ภาพพร้อมีกรอบตรวจ (Annotated)
                </button>
                <button
                  type="button"
                  className={`btn-tool ${activeImageTab === 'original' ? 'active' : ''}`}
                  onClick={() => setActiveImageTab('original')}
                >
                  ภาพต้นฉบับ (Original)
                </button>
              </div>
            </div>

            <div className="result-image-frame">
              {activeImageTab === 'annotated' && inspectionResult.images.annotated ? (
                <img
                  src={resolveImageUrl(inspectionResult.images.annotated) || ''}
                  alt="Annotated Inspection Result"
                />
              ) : inspectionResult.images.original ? (
                <img
                  src={resolveImageUrl(inspectionResult.images.original) || ''}
                  alt="Original Inspection Capture"
                />
              ) : (
                <div className="text-slate-400 text-sm">ไม่พบรูปภาพหรือยังไม่ได้บันทึก</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
