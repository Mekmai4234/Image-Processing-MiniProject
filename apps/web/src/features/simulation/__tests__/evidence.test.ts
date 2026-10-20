import { describe, expect, it } from 'vitest'
import { parseSimulationDefaults, suggestedAngles } from '../controller/config'
import { reportedCoverage, selectRepresentative, validateJob } from '../machine/evidence'
import { blob, config, locate } from './helpers'

describe('validateJob', () => {
  it('accepts a single photo with unknown angle', () => {
    expect(validateJob({ expected_product: 'bottle_a', views: [{ angle_deg: null, image: blob() }] }, config)).toEqual([])
  })

  it('requires real, distinct angles in a multi-view set', () => {
    const codes = validateJob(
      {
        expected_product: 'bottle_a',
        views: [
          { angle_deg: 0, image: blob() },
          { angle_deg: null, image: blob() },
          { angle_deg: 0, image: blob() },
          { angle_deg: 360, image: blob() },
        ],
      },
      config,
    ).map((i) => i.code)
    expect(codes).toEqual(['missing_angle', 'duplicate_angle', 'invalid_angle'])
  })

  it('enforces MAX_INSPECTION_VIEWS, product and non-empty images', () => {
    const views = Array.from({ length: 13 }, (_, i) => ({ angle_deg: i * 27, image: blob() }))
    expect(validateJob({ expected_product: 'bottle_a', views }, config).map((i) => i.code)).toContain('too_many_views')
    expect(validateJob({ expected_product: '', views: [{ angle_deg: 0, image: new Blob([]) }] }, config).map((i) => i.code)).toEqual([
      'no_product',
      'invalid_image',
    ])
  })
})

describe('reportedCoverage', () => {
  it.each([
    [[0, 90, 180, 270], 360],
    [[0, 30, 60], 90],
    [[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], 360],
    [[0], null],
    [[0, null], null],
  ])('%j → %s', (angles, expected) => {
    expect(reportedCoverage(angles)).toBe(expected)
  })
})

describe('selectRepresentative', () => {
  it('prefers bottle visible, then sharpness/label; ties keep the first tried', () => {
    expect(
      selectRepresentative([
        { view_index: 0, response: locate(false, { bottle_visible: false }) },
        { view_index: 1, response: locate(false, { sharp_enough: false }) },
        { view_index: 2, response: locate(false) },
        { view_index: 3, response: locate(false) },
      ]),
    ).toBe(2)
  })
})

describe('simulation_defaults', () => {
  it('validates the backend values and never falls back silently', () => {
    expect(parseSimulationDefaults({ simulation_defaults: { max_rotation_deg: 360, rotation_step_deg: 30 } })).toEqual({
      max_rotation_deg: 360,
      rotation_step_deg: 30,
    })
    expect(parseSimulationDefaults({})).toBeNull()
    expect(parseSimulationDefaults({ simulation_defaults: { max_rotation_deg: 720, rotation_step_deg: 30 } })).toBeNull()
    expect(parseSimulationDefaults({ simulation_defaults: { max_rotation_deg: 360, rotation_step_deg: 0 } })).toBeNull()
  })

  it('suggests 0..330 at the defaults', () => {
    expect(suggestedAngles({ max_rotation_deg: 360, rotation_step_deg: 30 })).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])
  })
})
