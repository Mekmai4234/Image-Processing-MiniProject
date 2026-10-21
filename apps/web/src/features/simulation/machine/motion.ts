import type { MachineState, Motion, Route } from './types'

/**
 * Simulated geometry and timing. These numbers describe the virtual line only; they are not
 * measurements of any real machine (02_simulation_3d/env.txt).
 *
 * Line (x grows left → right): dispenser → infeed belt → ORIENT turntable (locator camera)
 * → INSPECT enclosure (inspection camera) → REJECT pusher → REVIEW pusher → PASS belt.
 */
export const LAYOUT = {
  belt_y: 0.62,
  turntable_top_y: 0.7,
  dispenser_x: -8.4,
  turntable_x: -5.0,
  inspect_x: -1.7,
  reject_x: 1.3,
  review_x: 3.3,
  pass_gate_x: 4.9,
  pass_end_x: 7.6,
  tray_z: 1.8,
  pusher_rest_z: -0.95,
  /** Pusher plate front at full stroke. */
  pusher_reach_z: 0.31,
  bottle_radius: 0.24,
} as const

/** Simulation seconds at 1x. */
export const DURATIONS = {
  feed: 2.4,
  rotate_base: 0.35,
  rotate_per_90deg: 0.45,
  settle: 0.6,
  capture: 0.5,
  belt_units_per_s: 2.4,
  output_push: 1.5,
  output_pass: 1.1,
} as const

export function divertX(route: Route): number {
  if (route === 'reject') return LAYOUT.reject_x
  if (route === 'review') return LAYOUT.review_x
  return LAYOUT.pass_gate_x
}

export function feedMotion(): Motion {
  return { kind: 'feed', elapsed: 0, duration: DURATIONS.feed }
}

export function rotateMotion(fromDeg: number, toDeg: number): Motion {
  const delta = Math.abs(toDeg - fromDeg)
  return {
    kind: 'rotate',
    elapsed: 0,
    duration: DURATIONS.rotate_base + (delta / 90) * DURATIONS.rotate_per_90deg,
    from_deg: fromDeg,
    to_deg: toDeg,
  }
}

/** Turntable → inspection enclosure. The model keeps the angle that was chosen. */
export function toInspectMotion(): Motion {
  const distance = Math.abs(LAYOUT.inspect_x - LAYOUT.turntable_x)
  return { kind: 'to_inspect', elapsed: 0, duration: distance / DURATIONS.belt_units_per_s + 0.3 }
}

export function settleMotion(): Motion {
  return { kind: 'settle', elapsed: 0, duration: DURATIONS.settle }
}

export function captureMotion(): Motion {
  return { kind: 'capture', elapsed: 0, duration: DURATIONS.capture }
}

export function toDivertMotion(route: Route): Motion {
  const distance = Math.abs(divertX(route) - LAYOUT.inspect_x)
  return { kind: 'to_divert', elapsed: 0, duration: distance / DURATIONS.belt_units_per_s }
}

export function outputMotion(route: Route): Motion {
  return {
    kind: 'output',
    elapsed: 0,
    duration: route === 'pass' ? DURATIONS.output_pass : DURATIONS.output_push,
  }
}

export function progressOf(motion: Motion | null): number {
  if (!motion || motion.duration <= 0) return 1
  return Math.min(1, Math.max(0, motion.elapsed / motion.duration))
}

const PUSHED_Z = LAYOUT.pusher_reach_z + LAYOUT.bottle_radius

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

export type BottleStation = 'none' | 'belt' | 'turntable' | 'inspect' | 'tray' | 'pass'

export interface Pose {
  visible: boolean
  x: number
  y: number
  z: number
  /** Model rotation in degrees (turntable angle). */
  angle_deg: number
  /** Tilt in radians when the bottle drops into a tray/chute. */
  tilt: number
  /** Pusher extension 0..1. */
  reject_pusher: number
  review_pusher: number
  /** Inspection camera flash intensity 0..1. */
  flash: number
  /** Locator camera at the turntable is waiting on a locate request. */
  locating: boolean
  /** Where the bottle physically is, so the renderer can move belts/rollers under it only. */
  station: BottleStation
}

/**
 * Pure function from machine state to where things are. The renderer draws this and nothing
 * else, so the scene can never move a bottle somewhere the state machine did not put it.
 */
export function poseOf(state: MachineState): Pose {
  const pose: Pose = {
    visible: state.job !== null,
    x: LAYOUT.turntable_x,
    y: LAYOUT.turntable_top_y,
    z: 0,
    angle_deg: state.angle_deg,
    tilt: 0,
    reject_pusher: 0,
    review_pusher: 0,
    flash: 0,
    locating: false,
    station: 'turntable',
  }
  const motion = state.motion
  const t = progressOf(motion)
  const route = state.route ?? 'pass'

  switch (state.phase) {
    case 'IDLE':
      pose.visible = false
      pose.station = 'none'
      return pose
    case 'FEED': {
      pose.x = lerp(LAYOUT.dispenser_x, LAYOUT.turntable_x, easeInOut(t))
      pose.y = lerp(LAYOUT.belt_y, LAYOUT.turntable_top_y, clamp01((t - 0.85) / 0.15))
      pose.station = t < 0.85 ? 'belt' : 'turntable'
      return pose
    }
    case 'ORIENT':
      pose.locating = state.orient?.sub === 'locating'
      return pose
    case 'SETTLE':
      if (motion?.kind === 'rotate') return pose
      if (motion?.kind === 'to_inspect') {
        pose.x = lerp(LAYOUT.turntable_x, LAYOUT.inspect_x, easeInOut(t))
        pose.y = lerp(LAYOUT.turntable_top_y, LAYOUT.belt_y, clamp01(t / 0.12))
        pose.station = t < 0.12 ? 'turntable' : 'belt'
        return pose
      }
      return atInspect(pose)
    case 'INSPECT':
      atInspect(pose)
      pose.flash = motion?.kind === 'capture' ? Math.sin(Math.PI * t) : 0
      return pose
    case 'WAIT_RESULT':
      return atInspect(pose)
    case 'ERROR':
      return state.error_from?.phase === 'WAIT_RESULT' ? atInspect(pose) : pose
    case 'SORT': {
      pose.x = lerp(LAYOUT.inspect_x, divertX(route), easeInOut(t))
      pose.y = LAYOUT.belt_y
      pose.station = 'belt'
      return pose
    }
    case 'OUTPUT':
      return outputPose(pose, route, t)
    case 'COMPLETE':
      return outputPose(pose, route, 1)
  }
}

function atInspect(pose: Pose): Pose {
  pose.x = LAYOUT.inspect_x
  pose.y = LAYOUT.belt_y
  pose.station = 'inspect'
  return pose
}

function outputPose(pose: Pose, route: Route, t: number): Pose {
  pose.y = LAYOUT.belt_y
  if (route === 'pass') {
    pose.x = lerp(LAYOUT.pass_gate_x, LAYOUT.pass_end_x, easeInOut(t))
    pose.station = t < 1 ? 'belt' : 'pass'
    return pose
  }
  pose.x = divertX(route)
  // 0.00–0.40 pusher extends and meets the bottle, 0.40–0.75 bottle slides into the tray,
  // 0.70–1.00 pusher retracts. The bottle only moves sideways while the pusher touches it.
  const ext = t < 0.4 ? easeInOut(t / 0.4) : t < 0.7 ? 1 : 1 - easeInOut((t - 0.7) / 0.3)
  // The bottle moves only when the plate front actually touches it.
  const plateFront = lerp(LAYOUT.pusher_rest_z, LAYOUT.pusher_reach_z, ext)
  const contactZ = Math.max(0, plateFront + LAYOUT.bottle_radius)
  const slide = easeInOut(clamp01((t - 0.4) / 0.35))
  pose.z = t < 0.4 ? contactZ : lerp(PUSHED_Z, LAYOUT.tray_z, slide)
  pose.y = lerp(LAYOUT.belt_y, LAYOUT.belt_y - 0.42, slide)
  pose.tilt = slide * 0.22
  pose.station = slide > 0 ? 'tray' : 'belt'
  if (route === 'reject') pose.reject_pusher = ext
  else pose.review_pusher = ext
  return pose
}
