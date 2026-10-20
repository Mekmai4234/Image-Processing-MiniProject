import {
  DEFAULT_MAX_INSPECTION_VIEWS,
  DEMO_SIMULATION_DEFAULTS,
  type ProductsResponse,
  type SimulationDefaults,
} from '../api/contract'
import type { MachineConfig } from '../machine/types'

/** Real-time budget for the whole orientation search (pause/error time excluded). */
export const DEFAULT_ORIENT_BUDGET_MS = 60_000

/**
 * Validates simulation_defaults from GET /api/products. The browser never reads .env; the
 * backend owns these values. Returns null when the payload is missing or out of range so the
 * caller can show a config error instead of silently guessing.
 */
export function parseSimulationDefaults(products: ProductsResponse | unknown): SimulationDefaults | null {
  if (typeof products !== 'object' || products === null) return null
  const raw = (products as { simulation_defaults?: unknown }).simulation_defaults
  if (typeof raw !== 'object' || raw === null) return null
  const { max_rotation_deg, rotation_step_deg } = raw as Record<string, unknown>
  if (typeof max_rotation_deg !== 'number' || typeof rotation_step_deg !== 'number') return null
  if (!(max_rotation_deg > 0 && max_rotation_deg <= 360)) return null
  if (!(rotation_step_deg > 0 && rotation_step_deg <= max_rotation_deg)) return null
  return { max_rotation_deg, rotation_step_deg }
}

export function machineConfigFrom(
  defaults: SimulationDefaults = DEMO_SIMULATION_DEFAULTS,
  overrides: Partial<MachineConfig> = {},
): MachineConfig {
  return {
    max_rotation_deg: defaults.max_rotation_deg,
    rotation_step_deg: defaults.rotation_step_deg,
    max_views: DEFAULT_MAX_INSPECTION_VIEWS,
    orient_budget_ms: DEFAULT_ORIENT_BUDGET_MS,
    ...overrides,
  }
}

/** Suggested capture angles for the upload UI: 0, step, 2·step … below max (0..330 at defaults). */
export function suggestedAngles(defaults: SimulationDefaults): number[] {
  const angles: number[] = []
  const limit = Math.min(360, defaults.max_rotation_deg)
  for (let a = 0; a < limit && angles.length < DEFAULT_MAX_INSPECTION_VIEWS; a += defaults.rotation_step_deg) {
    angles.push(Math.round(a * 1000) / 1000)
  }
  return angles
}
