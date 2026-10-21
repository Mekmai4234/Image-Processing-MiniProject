import type { ProductId } from './api/contract'
import type { JobInput } from './machine/types'

/** Shape of an uploaded photo on the Simulation page (matches lib/views ViewItem). */
export interface UploadedView {
  blob: Blob
  name?: string
  /** Angle the user confirmed; null = unknown (allowed only for a single photo). */
  angle: number | null
}

/**
 * Converts the page's uploaded photos into a job. Order is kept as given; angles are passed
 * through untouched — nothing is guessed. validateJob() (run by controller.start) rejects a
 * multi-photo set that still has an unknown angle, so the page can ask the user to confirm it.
 */
export function toJobInput(expectedProduct: ProductId, views: readonly UploadedView[]): JobInput {
  return {
    expected_product: expectedProduct,
    views: views.map((view) => {
      const name = view.name ?? (typeof File !== 'undefined' && view.blob instanceof File ? view.blob.name : undefined)
      return name ? { angle_deg: view.angle, image: view.blob, name } : { angle_deg: view.angle, image: view.blob }
    }),
  }
}
