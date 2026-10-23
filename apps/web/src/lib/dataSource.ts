import type {
  HealthStatus,
  InspectionFilesResponse,
  InspectionFilters,
  InspectionPage,
  InspectionRequest,
  InspectionResult,
  LocateLabelResult,
  ProductCatalog,
  ProductId,
  ReviewRequest,
} from '../types/inspection'
import { api, resolveApiUrl } from './api'

export type ImageKind = 'original' | 'annotated' | { supporting: number }

/**
 * แหล่งข้อมูลของหน้าเว็บ: live = Backend จริง, demo = ข้อมูลสังเคราะห์จาก examples/
 * ทุกหน้าเรียกผ่าน interface นี้ เพื่อไม่ให้ mock ปนกับข้อมูลจริงในโค้ดหน้า
 */
export interface DataSource {
  bottleShape?(image: Blob, signal?: AbortSignal): ReturnType<typeof api.bottleShape>
  readonly kind: 'live' | 'demo'
  health(signal?: AbortSignal): Promise<HealthStatus>
  products(signal?: AbortSignal): Promise<ProductCatalog>
  locateLabel(image: Blob, expected: ProductId, signal?: AbortSignal): Promise<LocateLabelResult>
  createInspection(req: InspectionRequest, signal?: AbortSignal): Promise<InspectionResult>
  listInspections(filters: InspectionFilters, signal?: AbortSignal): Promise<InspectionPage>
  getInspection(id: string, signal?: AbortSignal): Promise<InspectionResult>
  getInspectionFiles(id: string, signal?: AbortSignal): Promise<InspectionFilesResponse>
  downloadZipUrl(id: string): string | null
  retrySave(id: string, signal?: AbortSignal): Promise<InspectionResult>
  review(id: string, body: ReviewRequest, signal?: AbortSignal): Promise<InspectionResult>
  /** null = ไม่มีไฟล์ CSV จริงให้ดาวน์โหลด */
  exportCsvUrl(filters: Omit<InspectionFilters, 'page' | 'page_size'>): string | null
  /** URL ภาพผ่าน API เท่านั้น ห้ามสร้าง file:// จาก path เครื่อง server */
  imageUrl(result: InspectionResult, kind: ImageKind): string | null
}

export const liveDataSource: DataSource = {
  bottleShape: api.bottleShape,
  kind: 'live',
  health: api.health,
  products: api.products,
  locateLabel: api.locateLabel,
  createInspection: api.createInspection,
  listInspections: api.listInspections,
  getInspection: api.getInspection,
  getInspectionFiles: api.getInspectionFiles,
  downloadZipUrl: api.downloadZipUrl,
  retrySave: api.retrySave,
  review: api.review,
  exportCsvUrl: api.exportCsvUrl,
  imageUrl(result, kind) {
    if (typeof kind === 'object') return resolveApiUrl(result.evidence.supporting_images[kind.supporting] ?? null)
    return resolveApiUrl(result.images[kind])
  },
}
