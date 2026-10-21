import { describe, expect, it } from 'vitest'
import { GENERIC_PROFILE, parseSilhouette, SHAPE_LIMITS, shapeFromSilhouette, type BottleShapeInput, type BottleSilhouette } from '../shape/bottleShape'
import { DEMO_FALLBACK, DEMO_SILHOUETTES, DEMO_STRAIGHT, DEMO_TAPERED, DEMO_WAISTED } from '../shape/samples'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('parseSilhouette', () => {
  it('accepts the bottle-silhouette-v1 JSON from ShapeResult.to_dict()', () => {
    for (const s of [...DEMO_SILHOUETTES, DEMO_FALLBACK]) expect(parseSilhouette(clone(s))).not.toBeNull()
  })

  it('ignores mask/contour/bbox extras and keeps only what the scene uses', () => {
    const withExtras = { ...clone(DEMO_STRAIGHT), mask: [[0, 1]], contour: [[1, 2]], bbox: { x: 1, y: 2, width: 3, height: 4 } }
    const parsed = parseSilhouette(withExtras)
    expect(parsed && 'mask' in parsed).toBe(false)
    expect(parsed?.radial_profile).toHaveLength(32)
  })

  it.each([
    ['wrong schema', (s: Record<string, unknown>) => (s.schema_version = 'bottle-silhouette-v2')],
    ['unknown status', (s: Record<string, unknown>) => (s.status = 'maybe')],
    ['non-monotonic profile', (s: Record<string, unknown>) => ((s.radial_profile as Array<{ y_fraction: number }>)[3]!.y_fraction = 0)],
    ['NaN radius', (s: Record<string, unknown>) => ((s.radial_profile as Array<{ radius_over_height: number }>)[2]!.radius_over_height = Number.NaN)],
    ['too few samples', (s: Record<string, unknown>) => (s.radial_profile = (s.radial_profile as unknown[]).slice(0, 4))],
    ['bad image size', (s: Record<string, unknown>) => (s.image_width = 0)],
  ])('rejects %s', (_name, mutate) => {
    const s = clone(DEMO_STRAIGHT) as unknown as Record<string, unknown>
    mutate(s)
    expect(parseSilhouette(s)).toBeNull()
  })
})

describe('shapeFromSilhouette', () => {
  it('converts with world_y = (1 - y_fraction)·H and world_radius = radius_over_height·H', () => {
    const spec = shapeFromSilhouette(DEMO_WAISTED)
    const H = spec.height
    expect(spec.source).toBe('silhouette')
    const body = spec.points.slice(1, -1)
    const byY = [...DEMO_WAISTED.radial_profile].sort((a, b) => b.y_fraction - a.y_fraction)
    body.forEach((p, i) => {
      const src = byY[i]!
      expect(p.y).toBeCloseTo((1 - src.y_fraction) * H, 9)
      expect(p.r).toBeCloseTo(src.radius_over_height * H, 9)
    })
  })

  it('orders points bottom → top and closes both ends on the axis (for LatheGeometry)', () => {
    const spec = shapeFromSilhouette(DEMO_TAPERED)
    const ys = spec.points.map((p) => p.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(spec.points[0]!.r).toBe(0)
    expect(spec.points.at(-1)!.r).toBe(0)
  })

  it('scales so the widest radius matches the pusher contact radius, within the height limits', () => {
    for (const s of DEMO_SILHOUETTES) {
      const spec = shapeFromSilhouette(s)
      expect(spec.height).toBeGreaterThanOrEqual(SHAPE_LIMITS.minHeight)
      expect(spec.height).toBeLessThanOrEqual(SHAPE_LIMITS.maxHeight)
      if (spec.height > SHAPE_LIMITS.minHeight && spec.height < SHAPE_LIMITS.maxHeight) {
        expect(spec.maxRadius).toBeCloseTo(SHAPE_LIMITS.targetRadius, 9)
      }
    }
  })

  it('keeps the original proportions (height/width) of each silhouette', () => {
    for (const s of DEMO_SILHOUETTES) {
      const spec = shapeFromSilhouette(s)
      const maxROverH = Math.max(...s.radial_profile.map((p) => p.radius_over_height))
      expect(spec.maxRadius / spec.height).toBeCloseTo(maxROverH, 9)
    }
  })

  it('different photos give visibly different outlines', () => {
    const mid = (s: BottleSilhouette) => {
      const spec = shapeFromSilhouette(s)
      const p = spec.points.reduce((best, q) => (Math.abs(q.y - spec.height * 0.38) < Math.abs(best.y - spec.height * 0.38) ? q : best))
      return p.r / spec.maxRadius
    }
    expect(mid(DEMO_WAISTED)).toBeLessThan(0.9)
    expect(mid(DEMO_STRAIGHT)).toBeGreaterThan(0.95)
  })

  it('places the cap at the top and the label on the body below it', () => {
    for (const s of DEMO_SILHOUETTES) {
      const spec = shapeFromSilhouette(s)
      expect(spec.capStartY).toBeGreaterThan(spec.height * 0.8)
      expect(spec.capStartY).toBeLessThan(spec.height)
      expect(spec.label.y1).toBeLessThan(spec.capStartY)
      expect(spec.label.y1 - spec.label.y0).toBeGreaterThan(0.05)
    }
  })

  it.each([
    ['null (no silhouette yet)', null, 'no_silhouette'],
    ['status fallback from 03', DEMO_FALLBACK, 'truncated_or_not_upright'],
  ])('uses the generic shape for %s and says why', (_n, input, reason) => {
    const spec = shapeFromSilhouette(input)
    expect(spec.source).toBe('fallback')
    expect(spec.reason).toBe(reason)
    expect(spec.height).toBe(SHAPE_LIMITS.defaultHeight)
    expect(spec.points.length).toBe(GENERIC_PROFILE.length + 2)
  })
})

describe('bottleShape prop input (raw POST /api/bottle-shape response)', () => {
  // Same shape as docs/api-contract.md: bbox/contour present, quality fields may be null.
  interface ApiLikeResult {
    schema_version: string
    status: 'ready' | 'fallback'
    reason: string
    image_width: number
    image_height: number
    bbox: { x: number; y: number; width: number; height: number } | null
    normalized_width: number | null
    normalized_height: number | null
    aspect_ratio: number | null
    contour: Array<[number, number]>
    radial_profile: Array<{ y_fraction: number; radius_over_height: number }>
    quality: { whole_bottle_visible: boolean; center_drift: number | null; axisymmetric_assumption: boolean }
  }

  const ready: ApiLikeResult = {
    ...(clone(DEMO_STRAIGHT) as unknown as ApiLikeResult),
    bbox: { x: 65, y: 30, width: 111, height: 291 },
    contour: [[95, 30], [65, 110], [175, 110], [145, 30]],
    quality: { whole_bottle_visible: true, center_drift: 0, axisymmetric_assumption: true },
  }
  const fallback: ApiLikeResult = {
    schema_version: 'bottle-silhouette-v1',
    status: 'fallback',
    reason: 'bottle_not_isolated',
    image_width: 240,
    image_height: 360,
    bbox: null,
    normalized_width: null,
    normalized_height: null,
    aspect_ratio: null,
    contour: [],
    radial_profile: [],
    quality: { whole_bottle_visible: false, center_drift: null, axisymmetric_assumption: true },
  }

  it('accepts an API-shaped type without conversion', () => {
    const input: BottleShapeInput = ready // compile-time check: 01's type assigns directly
    expect(shapeFromSilhouette(parseSilhouette(input)).source).toBe('silhouette')
  })

  it('uses the generic shape for fallback, null and garbage', () => {
    expect(shapeFromSilhouette(parseSilhouette(fallback)).source).toBe('fallback')
    expect(shapeFromSilhouette(parseSilhouette(null)).source).toBe('fallback')
    expect(shapeFromSilhouette(parseSilhouette({ schema_version: 'x', status: 'ready', reason: '', radial_profile: [] })).source).toBe('fallback')
  })
})
