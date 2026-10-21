/**
 * Contract types used by the simulation.
 *
 * The shapes come from the shared file `src/types/inspection.ts` (owned by 01/03/04); this
 * module only re-exports them under the names the simulation already uses and adds a few
 * simulation-only constants. Do not redeclare contract fields here.
 */
import type {
  InspectionResultValue,
  LocateLabelResult,
  ProductCatalog,
} from '../../../types/inspection'
import { REASONS } from '../../../types/inspection'

export type {
  ApiErrorBody,
  BBox,
  EvidenceKind,
  EvidenceRequest,
  EvidenceResponse,
  InspectionReason,
  InspectionRequest,
  InspectionResult,
  LocatorReason,
  Product,
  ProductId,
  SearchStatus,
  SourceMode,
  StorageError,
  StorageStatus,
} from '../../../types/inspection'

export type InspectionVerdict = InspectionResultValue
export type LocateLabelResponse = LocateLabelResult
/** GET /api/products */
export type ProductsResponse = ProductCatalog

export const REASONS_BY_RESULT = REASONS

export interface SimulationDefaults {
  max_rotation_deg: number
  rotation_step_deg: number
}

/** Contract limit: image + supporting_images per request (MAX_INSPECTION_VIEWS default). */
export const DEFAULT_MAX_INSPECTION_VIEWS = 12

/** docs/configuration.md defaults, used only when the catalog has no simulation_defaults in DEMO. */
export const DEMO_SIMULATION_DEFAULTS: SimulationDefaults = {
  max_rotation_deg: 360,
  rotation_step_deg: 30,
}
