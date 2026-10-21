/**
 * Bottle shape for the scene from 03's `bottle-silhouette-v1` (apps/backend/app/inspection/SHAPE.md).
 *
 * The silhouette is a single front view of an upright bottle, turned into a surface of
 * revolution. It is an approximate representation for the 3D scene only: it never feeds the
 * label inspection, and the unseen sides are assumed symmetric. Transport from the backend is
 * not defined yet (04); until then callers pass a parsed object or null.
 */

export const SILHOUETTE_SCHEMA = 'bottle-silhouette-v1'

export interface ProfileSample {
  /** 0 = top of the bottle, 1 = bottom. */
  y_fraction: number
  /** Half the silhouette width on that row divided by the bbox height. */
  radius_over_height: number
}

/** The JSON fields of ShapeResult.to_dict() that the scene uses (mask/contour are not needed). */
export interface BottleSilhouette {
  schema_version: typeof SILHOUETTE_SCHEMA
  status: 'ready' | 'fallback'
  reason: string
  image_width: number
  image_height: number
  normalized_width: number | null
  normalized_height: number | null
  aspect_ratio: number | null
  radial_profile: ProfileSample[]
  quality: {
    whole_bottle_visible?: boolean
    center_drift?: number
    axisymmetric_assumption?: boolean
  }
}

/**
 * The POST /api/bottle-shape response (bottle-silhouette-v1) exactly as the page receives it.
 * Only the fields the scene reads are listed, with wide types, so 01's response type (with bbox,
 * contour, nullable quality fields, …) can be passed straight in. The scene validates it with
 * parseSilhouette(); anything unusable falls back to the generic bottle.
 */
export interface BottleShapeInput {
  schema_version: string
  status: string
  reason: string
  radial_profile: ReadonlyArray<{ y_fraction: number; radius_over_height: number }>
}

export type ShapeSource = 'silhouette' | 'fallback'

/** World-space lathe profile, ready for THREE.LatheGeometry (points from bottom to top). */
export interface BottleShapeSpec {
  source: ShapeSource
  /** Why the generic shape is used, or 'usable_silhouette'. */
  reason: string
  /** World height of the whole bottle including the cap. */
  height: number
  /** Widest radius in world units. */
  maxRadius: number
  /** Body outline from bottom (y=0) to top, radius in world units. */
  points: Array<{ r: number; y: number }>
  /** y where the cap starts; the part above is drawn in the cap colour. */
  capStartY: number
  /** Label band position (world y), placed on the straightest part of the body. */
  label: { y0: number; y1: number; radius: number }
}

/** Scene limits: the pusher and turntable are sized for this radius. */
export const SHAPE_LIMITS = {
  targetRadius: 0.24,
  minHeight: 0.7,
  /** Must clear the inspection camera ring above the belt. */
  maxHeight: 1.15,
  defaultHeight: 1.05,
} as const

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Strict shape check. Anything unexpected → null, so the caller shows the fallback shape
 * instead of drawing a made-up bottle.
 */
export function parseSilhouette(value: unknown): BottleSilhouette | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.schema_version !== SILHOUETTE_SCHEMA) return null
  if (v.status !== 'ready' && v.status !== 'fallback') return null
  if (typeof v.reason !== 'string') return null
  if (!isNum(v.image_width) || !isNum(v.image_height) || v.image_width <= 0 || v.image_height <= 0) return null
  const profile = Array.isArray(v.radial_profile) ? v.radial_profile : null
  if (!profile) return null
  const samples: ProfileSample[] = []
  for (const row of profile) {
    if (typeof row !== 'object' || row === null) return null
    const r = row as Record<string, unknown>
    if (!isNum(r.y_fraction) || !isNum(r.radius_over_height)) return null
    if (r.y_fraction < 0 || r.y_fraction > 1 || r.radius_over_height < 0 || r.radius_over_height > 2) return null
    samples.push({ y_fraction: r.y_fraction, radius_over_height: r.radius_over_height })
  }
  if (v.status === 'ready' && (samples.length < 8 || samples.length > 256)) return null
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const cur = samples[i]
    if (prev && cur && cur.y_fraction <= prev.y_fraction) return null
  }
  const optNum = (x: unknown) => (x === null || x === undefined ? null : isNum(x) ? x : undefined)
  const nw = optNum(v.normalized_width)
  const nh = optNum(v.normalized_height)
  const ar = optNum(v.aspect_ratio)
  if (nw === undefined || nh === undefined || ar === undefined) return null
  const q = typeof v.quality === 'object' && v.quality !== null ? (v.quality as BottleSilhouette['quality']) : {}
  return {
    schema_version: SILHOUETTE_SCHEMA,
    status: v.status,
    reason: v.reason,
    image_width: v.image_width,
    image_height: v.image_height,
    normalized_width: nw,
    normalized_height: nh,
    aspect_ratio: ar,
    radial_profile: samples,
    quality: q,
  }
}

/** Generic bottle used when no usable silhouette exists (same proportions as before). */
export const GENERIC_PROFILE: ProfileSample[] = (
  [
    [0.0, 0.095], [0.09, 0.095], [0.1, 0.086], [0.16, 0.09], [0.24, 0.11], [0.31, 0.15],
    [0.37, 0.205], [0.41, 0.2286], [0.6, 0.2286], [0.8, 0.2286], [0.96, 0.2286], [1.0, 0.19],
  ] as const
).map(([y, r]) => ({ y_fraction: y, radius_over_height: r }))

/**
 * Converts a silhouette into world geometry, following SHAPE.md:
 *   world_y = (1 - y_fraction) * H,  world_radius = radius_over_height * H
 * H is chosen so the widest radius matches the scene's bottle radius (the pusher touches the
 * bottle where the physics expects it), clamped to a sensible height range.
 */
export function shapeFromSilhouette(silhouette: BottleSilhouette | null | undefined): BottleShapeSpec {
  if (!silhouette) return fromProfile(GENERIC_PROFILE, 'fallback', 'no_silhouette', SHAPE_LIMITS.defaultHeight)
  if (silhouette.status !== 'ready') return fromProfile(GENERIC_PROFILE, 'fallback', silhouette.reason || 'fallback', SHAPE_LIMITS.defaultHeight)
  const maxROverH = Math.max(...silhouette.radial_profile.map((p) => p.radius_over_height))
  if (!(maxROverH > 0)) return fromProfile(GENERIC_PROFILE, 'fallback', 'empty_profile', SHAPE_LIMITS.defaultHeight)
  const height = clamp(SHAPE_LIMITS.targetRadius / maxROverH, SHAPE_LIMITS.minHeight, SHAPE_LIMITS.maxHeight)
  return fromProfile(silhouette.radial_profile, 'silhouette', 'usable_silhouette', height)
}

function fromProfile(profile: ProfileSample[], source: ShapeSource, reason: string, height: number): BottleShapeSpec {
  // Bottom → top for the lathe, closed at both ends on the axis.
  const body = [...profile]
    .sort((a, b) => b.y_fraction - a.y_fraction)
    .map((p) => ({ r: p.radius_over_height * height, y: (1 - p.y_fraction) * height }))
  const points = [{ r: 0, y: body[0]?.y ?? 0 }, ...body, { r: 0, y: body[body.length - 1]?.y ?? height }]
  const maxRadius = Math.max(...body.map((p) => p.r))
  return {
    source,
    reason,
    height,
    maxRadius,
    points,
    capStartY: findCapStart(body, height),
    label: findLabelBand(body, height, maxRadius),
  }
}

/** Cap = the narrow top section above the neck (top ~12 % with radius < 55 % of max). */
function findCapStart(body: Array<{ r: number; y: number }>, height: number): number {
  const maxR = Math.max(...body.map((p) => p.r))
  let start = height
  for (let i = body.length - 1; i >= 0; i--) {
    const p = body[i]
    if (!p) continue
    if (p.y < height * 0.86 || p.r > maxR * 0.55) break
    start = p.y
  }
  return Math.min(start, height * 0.97)
}

/**
 * Label band on the longest nearly-straight, wide section of the body (where a wrap label can
 * sit), between 8 % and 80 % of the height. Without such a section (e.g. a cone), a band around
 * 40 % of the height that follows the outline. The real label position will come from the
 * locator/inspection bbox later; this is only a placeholder band to show rotation.
 */
function findLabelBand(body: Array<{ r: number; y: number }>, height: number, maxRadius: number): { y0: number; y1: number; radius: number } {
  let best = { y0: 0, y1: 0 }
  let runStart: number | null = null
  let runEnd = 0
  for (let i = 1; i <= body.length; i++) {
    const a = body[i - 1]
    const b = body[i]
    const ok =
      a !== undefined && b !== undefined &&
      a.y >= height * 0.08 && b.y <= height * 0.8 &&
      Math.min(a.r, b.r) >= maxRadius * 0.75 &&
      Math.abs(b.r - a.r) / Math.max(1e-9, b.y - a.y) < 0.12
    if (ok && a && b) {
      if (runStart === null) runStart = a.y
      runEnd = b.y
    } else if (runStart !== null) {
      if (runEnd - runStart > best.y1 - best.y0) best = { y0: runStart, y1: runEnd }
      runStart = null
    }
  }
  if (best.y1 - best.y0 < height * 0.12) best = { y0: height * 0.28, y1: height * 0.52 }
  const mid = (best.y0 + best.y1) / 2
  const half = Math.min((best.y1 - best.y0) / 2, height * 0.15)
  return { y0: mid - half, y1: mid + half, radius: maxRadius * 1.01 }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
