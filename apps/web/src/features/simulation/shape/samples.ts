import { SILHOUETTE_SCHEMA, type BottleSilhouette, type ProfileSample } from './bottleShape'

/**
 * DEMO silhouettes in the bottle-silhouette-v1 shape, generated from simple formulas. They are
 * NOT measured from real bottles; they exist so the scene and tests can exercise different
 * shapes until 04 exposes 03's analyze_shape and 05 provides real photos.
 */
function profile(fn: (y: number) => number, samples = 32): ProfileSample[] {
  return Array.from({ length: samples }, (_, i) => {
    const y = i / (samples - 1)
    return { y_fraction: y, radius_over_height: Math.max(0, fn(y)) }
  })
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

function demo(name: string, fn: (y: number) => number, aspect: number): BottleSilhouette & { demo_name: string } {
  const rows = profile(fn)
  return {
    demo_name: name,
    schema_version: SILHOUETTE_SCHEMA,
    status: 'ready',
    reason: 'usable_silhouette',
    image_width: 400,
    image_height: 500,
    normalized_width: (aspect * 0.8 * 500) / 400,
    normalized_height: 0.8,
    aspect_ratio: aspect,
    radial_profile: rows,
    quality: { whole_bottle_visible: true, center_drift: 0.01, axisymmetric_assumption: true },
  }
}

/** Tall straight water bottle: short cap, gentle shoulder. */
export const DEMO_STRAIGHT = demo(
  'DEMO ทรงตรง',
  (y) => 0.045 + (0.155 - 0.045) * smooth(0.08, 0.3, y) - 0.01 * smooth(0.97, 1, y),
  0.31,
)

/** Waisted bottle (narrower in the middle). */
export const DEMO_WAISTED = demo(
  'DEMO เว้าเอว',
  (y) => {
    const body = 0.05 + (0.2 - 0.05) * smooth(0.1, 0.32, y)
    const waist = 0.045 * Math.exp(-Math.pow((y - 0.62) / 0.09, 2))
    return body - waist - 0.012 * smooth(0.96, 1, y)
  },
  0.4,
)

/** Tapered bottle (wider at the bottom). */
export const DEMO_TAPERED = demo(
  'DEMO ทรงสอบ',
  (y) => (y < 0.1 ? 0.05 : 0.06 + 0.17 * smooth(0.1, 1, y) - 0.01 * smooth(0.97, 1, y)),
  0.46,
)

/** What 03 returns when the photo cannot be used (no profile, explicit reason). */
export const DEMO_FALLBACK: BottleSilhouette = {
  schema_version: SILHOUETTE_SCHEMA,
  status: 'fallback',
  reason: 'truncated_or_not_upright',
  image_width: 400,
  image_height: 500,
  normalized_width: null,
  normalized_height: null,
  aspect_ratio: null,
  radial_profile: [],
  quality: { whole_bottle_visible: false, axisymmetric_assumption: true },
}

export const DEMO_SILHOUETTES = [DEMO_STRAIGHT, DEMO_WAISTED, DEMO_TAPERED] as const
