import type { InspectionResult } from '../../types/inspection'

export type CameraStatus = 'idle' | 'requesting' | 'streaming' | 'error'

export interface CameraDevice {
  deviceId: string
  label: string
}

export type GuidanceTone = 'info' | 'warning' | 'success' | 'danger'

export interface GuidanceInfo {
  text: string
  subtext: string
  tone: GuidanceTone
  readyToCapture: boolean
}

export interface CaptureFrameResult {
  blob: Blob
  width: number
  height: number
  timestamp: number
}

export interface CameraPanelProps {
  expectedProduct?: string
  onProductChange?: (productId: string) => void
  onInspectionComplete?: (result: InspectionResult) => void
  onNavigateToHistory?: () => void
  autoLocate?: boolean
  className?: string
}
