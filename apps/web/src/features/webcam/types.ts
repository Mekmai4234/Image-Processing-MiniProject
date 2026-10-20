import type { InspectionResult } from '../../types/inspection'
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

export interface CaptureFrameResult {
  blob: Blob
  width: number
  height: number
  timestamp: number
}

export interface CameraPanelProps {
  dataSource?: DataSource
  sourceKind?: SourceKind
  expectedProduct?: string
  onProductChange?: (productId: string) => void
  onInspectionComplete?: (result: InspectionResult) => void
  onNavigateToHistory?: () => void
  autoLocate?: boolean
  className?: string
}
