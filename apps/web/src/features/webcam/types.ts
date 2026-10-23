import type { InspectionResult, Product } from '../../types/inspection'
import type { DataSource } from '../../lib/dataSource'
import type { SourceKind } from '../../lib/AppData'

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

export type AutoCapturePhase =
  | 'idle'
  | 'waiting_bottle'
  | 'holding'
  | 'inspecting'
  | 'awaiting_removal'
  | 'error_waiting_retry'

export interface CaptureFrameResult {
  blob: Blob
  width: number
  height: number
  timestamp: number
}

export interface CameraPanelProps {
  children?: import('react').ReactNode
  dataSource?: DataSource
  sourceKind?: SourceKind
  products?: Product[]
  expectedProduct?: string
  onProductChange?: (productId: string) => void
  onInspectionComplete?: (result: InspectionResult) => void
  onNavigateToHistory?: () => void
  autoLocate?: boolean
  className?: string
}
