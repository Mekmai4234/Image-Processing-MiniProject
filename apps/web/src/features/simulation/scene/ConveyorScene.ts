import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { InspectionVerdict } from '../api/contract'
import { LAYOUT, poseOf, type Pose } from '../machine/motion'
import type { MachineState } from '../machine/types'
import { shapeFromSilhouette, type BottleShapeSpec } from '../shape/bottleShape'
import {
  beltMap,
  brushedRoughness,
  capMap,
  extrusionMap,
  floorMap,
  hazardMap,
  rollerMap,
  ventPanel,
  waveLabel,
} from './textures'

export type SceneQuality = 'auto' | 'high' | 'low'

export interface ConveyorSceneOptions {
  reducedMotion?: boolean
  /** 'auto' starts high and drops to low once if the frame rate stays poor. */
  quality?: SceneQuality
}

/** Shared design tokens of the team (00-ข้อตกลงร่วม): navy background, cyan accent. */
const COLORS = {
  background: 0x041326,
  aluminium: 0xc9d2dc,
  pass: 0x22c55e,
  reject: 0xdc2626,
  review: 0xf5b301,
  accent: 0x12d5f5,
}

const PRODUCT_ACCENT: Record<string, string> = { bottle_a: '#1d4ed8', bottle_b: '#15803d' }
const VERDICT_COLORS: Record<InspectionVerdict, string> = { PASS: '#22c55e', FAIL: '#ef4444', REVIEW: '#f5b301' }

const BELT_HALF = 0.42
const RAIL_HALF = BELT_HALF + 0.07
const ROLLER_R = 0.045
const ROLLER_PITCH = 0.2
const QUEUE_Z = -1.15
const LINE_LEFT = LAYOUT.dispenser_x - 1.4
const LINE_RIGHT = LAYOUT.pass_end_x + 1.0
const VIEW_TARGET = new THREE.Vector3(-1.0, 0.7, 0.1)
/** Oblique view from the front-left, as in the reference picture. */
const VIEW_DIRECTION = new THREE.Vector3(-0.5, 0.45, 0.74).normalize()
/**
 * Points that must stay in frame. Like the reference, the view is close: the far-left dispenser
 * may be cropped, but every station, destination and the finished bottle's verdict tag stay visible.
 */
const FIT_POINTS = [
  new THREE.Vector3(LAYOUT.dispenser_x + 1.2, 2.7, -0.85),
  new THREE.Vector3(LAYOUT.turntable_x - LAYOUT.turntable_radius, 0.7, 0),
  new THREE.Vector3(LAYOUT.turntable_x, 0.7, LAYOUT.turntable_radius),
  new THREE.Vector3(LAYOUT.turntable_x, 2.6, -1.2),
  new THREE.Vector3(LAYOUT.inspect_x, 3.3, -0.9),
  new THREE.Vector3(LAYOUT.pass_end_x, 1.9, 0.3),
  // Verdict tag above the bottle when it stops at the end of the PASS belt (sprite half-width ≈ 0.65).
  new THREE.Vector3(LAYOUT.pass_end_x + 0.7, 2.25, 0.25),
  new THREE.Vector3(LAYOUT.pass_end_x, 0.6, -0.5),
  new THREE.Vector3(LAYOUT.review_x + 0.6, 0.1, LAYOUT.tray_z + 0.5),
  new THREE.Vector3(LAYOUT.reject_x - 0.6, 0.1, LAYOUT.tray_z + 0.5),
]

interface ConveyorSection {
  x0: number
  x1: number
  belt: THREE.Texture
  rollers: THREE.Texture
}

let liveInstances = 0

/**
 * Renders the virtual line from MachineState. It owns no timers and no logic: positions come
 * from poseOf(state). Call render() from the host's animation frame and dispose() on unmount.
 * Decorative bottles (dispenser, queue belt, table rim) are scenery only; they never create
 * inspections. The inspected bottle is marked with a cyan ring.
 */
export class ConveyorScene {
  static get liveInstances(): number {
    return liveInstances
  }

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly resizeObserver: ResizeObserver
  private readonly reducedMotion: boolean
  private readonly envTexture: THREE.Texture
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private readonly qualityMode: SceneQuality
  private highQuality: boolean
  private frameTimes: number[] = []
  private framesSeen = 0

  private readonly textures: THREE.Texture[] = []
  private readonly bottle = new THREE.Group()
  /** Inner group spun by the turntable angle; the outer group carries position and tilt. */
  private readonly bottleSpin = new THREE.Group()
  private labelBand!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  private water!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
  private activeRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private bodyMat!: THREE.MeshPhysicalMaterial
  private capMat!: THREE.MeshStandardMaterial
  private decorGlass: THREE.MeshPhysicalMaterial | null = null
  private shape!: BottleShapeSpec
  private readonly turntableTop = new THREE.Group()
  private readonly rejectPlate = new THREE.Group()
  private readonly reviewPlate = new THREE.Group()
  private readonly inspectLights: THREE.MeshStandardMaterial[] = []
  private inspectSpot!: THREE.SpotLight
  private locatorLed!: THREE.MeshStandardMaterial
  private readonly stack = {
    green: new THREE.MeshStandardMaterial({ color: 0x0b3b1e, emissive: 0x22c55e, emissiveIntensity: 0 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0x3b2d06, emissive: 0xf5b301, emissiveIntensity: 0 }),
    red: new THREE.MeshStandardMaterial({ color: 0x3b0b0b, emissive: 0xef4444, emissiveIntensity: 0 }),
  }
  private readonly sections: ConveyorSection[] = []
  private readonly tag: THREE.Sprite
  private tagKey = ''
  private productKey = ''
  private lastPose: Pose | null = null
  private clock = 0
  private disposed = false
  private brushedTex: THREE.Texture | null = null
  private extrusionMat: THREE.MeshStandardMaterial | null = null
  private decorGeo: THREE.LatheGeometry | null = null

  constructor(private readonly container: HTMLElement, options: ConveyorSceneOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false
    this.qualityMode = options.quality ?? 'auto'
    this.highQuality = this.qualityMode !== 'low'

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.78
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    const canvasEl = this.renderer.domElement
    canvasEl.setAttribute('aria-hidden', 'true')
    canvasEl.style.display = 'block'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    container.appendChild(canvasEl)

    // Studio reflections so metal and glass read correctly.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.envTexture = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.envTexture
    this.scene.environmentIntensity = 0.5
    this.scene.background = new THREE.Color(COLORS.background)
    this.scene.fog = new THREE.Fog(COLORS.background, 18, 40)

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 120)
    this.controls = new OrbitControls(this.camera, canvasEl)
    this.controls.target.copy(VIEW_TARGET)
    this.controls.enableDamping = !this.reducedMotion
    this.controls.minDistance = 4
    this.controls.maxDistance = 30
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.enablePan = false

    this.buildLights()
    this.buildFloor()
    this.buildConveyor(LAYOUT.dispenser_x - 0.6, LAYOUT.turntable_x - LAYOUT.turntable_radius + 0.05, '#1b232d', '#252f3b')
    this.buildConveyor(LAYOUT.turntable_x + LAYOUT.turntable_radius - 0.05, LAYOUT.pass_gate_x + 0.3, '#1b232d', '#252f3b')
    this.buildConveyor(LAYOUT.pass_gate_x + 0.3, LAYOUT.pass_end_x + 0.7, '#0f5a2e', '#16733b')
    this.buildQueueBelt()
    this.buildDispenser()
    this.buildTurntable()
    this.buildInspectTower()
    this.buildPusher(LAYOUT.reject_x, COLORS.reject, this.rejectPlate)
    this.buildPusher(LAYOUT.review_x, COLORS.review, this.reviewPlate)
    this.buildChuteAndTray(LAYOUT.reject_x, COLORS.reject)
    this.buildChuteAndTray(LAYOUT.review_x, COLORS.review)
    this.buildPassEnd()
    this.buildStackLight()
    this.buildCallouts()

    const r = LAYOUT.bottle_radius
    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(r + 0.05, r + 0.1, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.activeRing.rotation.x = -Math.PI / 2
    this.activeRing.visible = false
    this.scene.add(this.activeRing)
    this.buildBottle()
    this.tag = this.makeSprite(' ', '#ffffff', 'rgba(4,19,38,0.9)', 1.3)
    this.tag.visible = false
    this.scene.add(this.tag)

    this.applyQuality()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    liveInstances += 1
  }

  get quality(): 'high' | 'low' {
    return this.highQuality ? 'high' : 'low'
  }

  render(state: Readonly<MachineState>, realDtSeconds: number): void {
    if (this.disposed) return
    this.clock += realDtSeconds
    this.watchFrameRate(realDtSeconds)
    const pose = poseOf(state as MachineState)
    const animate = !this.reducedMotion

    this.syncProduct(state.job?.expected_product ?? '')
    this.bottle.visible = pose.visible
    this.bottle.position.set(pose.x, pose.y, pose.z)
    this.bottle.rotation.x = pose.tilt
    this.bottleSpin.rotation.y = THREE.MathUtils.degToRad(-pose.angle_deg)
    // The whole round table turns with the bottle standing at its centre.
    if (pose.station === 'turntable') this.turntableTop.rotation.y = this.bottleSpin.rotation.y

    // Belt and rollers move exactly as far as the bottle riding on them, and only that section.
    const prev = this.lastPose
    if (animate && prev && prev.visible && pose.station === 'belt' && prev.station !== 'none') {
      const dx = pose.x - prev.x
      if (dx !== 0) {
        for (const section of this.sections) {
          if (pose.x < section.x0 - 0.05 || pose.x > section.x1 + 0.05) continue
          section.belt.offset.x -= dx / 0.5
          section.rollers.offset.x -= dx / (2 * Math.PI * ROLLER_R)
        }
      }
    }
    this.lastPose = pose

    // The motion model assumes LAYOUT.bottle_radius; a slimmer silhouette shifts the plate
    // forward by the difference so it still touches the bottle exactly when the bottle moves.
    const plateOffset = LAYOUT.bottle_radius - this.shape.maxRadius
    this.rejectPlate.position.z = THREE.MathUtils.lerp(LAYOUT.pusher_rest_z, LAYOUT.pusher_reach_z, pose.reject_pusher) + plateOffset
    this.reviewPlate.position.z = THREE.MathUtils.lerp(LAYOUT.pusher_rest_z, LAYOUT.pusher_reach_z, pose.review_pusher) + plateOffset

    const flash = animate ? pose.flash : Math.min(pose.flash, 0.5)
    for (const m of this.inspectLights) m.emissiveIntensity = 2.2 + flash * 6
    this.inspectSpot.intensity = 8 + flash * 70
    const pulse = pose.locating ? (animate ? 0.6 + 0.4 * Math.sin(this.clock * 8) : 1) : 0.15
    this.locatorLed.emissiveIntensity = 3 * pulse
    this.updateStackLight(state)

    this.activeRing.visible = pose.visible && (pose.station === 'belt' || pose.station === 'turntable' || pose.station === 'inspect')
    if (this.activeRing.visible) {
      this.activeRing.position.set(pose.x, pose.y + 0.012, pose.z)
      this.activeRing.material.opacity = animate ? 0.6 + 0.25 * Math.sin(this.clock * 3) : 0.8
    }

    this.updateTag(state, pose)
    this.controls.update()
    if (this.composer) this.composer.render(realDtSeconds)
    else this.renderer.render(this.scene, this.camera)
  }

  /** Rebuilds the inspected bottle from a shape spec (silhouette or generic fallback). */
  setBottleShape(spec: BottleShapeSpec): void {
    if (this.disposed || spec === this.shape) return
    this.applyShape(spec)
  }

  /** Releases every GPU resource and listener. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.disposeComposer()
    const textures = new Set<THREE.Texture>([this.envTexture, ...this.textures])
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
        material.dispose()
      }
      if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose()
    })
    for (const m of Object.values(this.stack)) m.dispose()
    for (const texture of textures) texture.dispose()
    this.scene.environment = null
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    liveInstances -= 1
  }

  // ---- quality & framing ---------------------------------------------------------------

  private disposeComposer(): void {
    this.composer?.dispose()
    this.bloom?.dispose()
    this.composer = null
    this.bloom = null
  }

  private applyQuality(): void {
    this.disposeComposer()
    // Glass refraction (transmission) costs an extra pass; low quality uses plain transparency.
    for (const m of [this.bodyMat, this.decorGlass]) {
      if (!m) continue
      m.transmission = this.highQuality ? 1 : 0
      m.opacity = this.highQuality ? 1 : 0.45
      m.needsUpdate = true
    }
    if (this.water) {
      this.water.material.transmission = this.highQuality ? 0.9 : 0
      this.water.material.opacity = this.highQuality ? 1 : 0.35
      this.water.material.needsUpdate = true
    }
    if (!this.highQuality) return
    const size = this.renderer.getSize(new THREE.Vector2())
    const w = Math.max(1, size.x)
    const h = Math.max(1, size.y)
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    // Bloom only on bright emissive parts (LED bars, ring light, stack light, call-out dots).
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 0.97)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bloom = bloom
  }

  /** In 'auto', drop to low quality once if frames stay slower than ~25 fps. */
  private watchFrameRate(dt: number): void {
    if (this.qualityMode !== 'auto' || !this.highQuality) return
    this.framesSeen += 1
    if (this.framesSeen < 30 || dt <= 0 || dt > 1) return
    this.frameTimes.push(dt)
    if (this.frameTimes.length < 90) return
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    this.frameTimes = []
    if (avg > 0.04) {
      this.highQuality = false
      this.applyQuality()
      this.resize()
    }
  }

  private resize(): void {
    // Re-framing on resize resets any orbit the user made; acceptable for a fixed-layout panel.
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.composer?.setSize(width, height)
    const aspect = width / height
    this.camera.aspect = aspect
    this.camera.fov = aspect < 1.2 ? 44 : 30
    this.camera.updateProjectionMatrix()
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    // Binary-search the distance until every fit point is in frame, then centre and fill.
    let lo = 3
    let hi = this.controls.maxDistance
    const p = new THREE.Vector3()
    this.controls.target.copy(VIEW_TARGET)
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      this.camera.position.copy(VIEW_TARGET).addScaledVector(VIEW_DIRECTION, mid)
      this.camera.lookAt(VIEW_TARGET)
      this.camera.updateMatrixWorld()
      const fits = FIT_POINTS.every((pt) => {
        p.copy(pt).project(this.camera)
        return Math.abs(p.x) <= 0.97 && Math.abs(p.y) <= 0.94
      })
      if (fits) hi = mid
      else lo = mid
    }
    this.camera.position.copy(VIEW_TARGET).addScaledVector(VIEW_DIRECTION, hi)
    for (let pass = 0; pass < 3; pass++) {
      this.camera.lookAt(this.controls.target)
      this.camera.updateMatrixWorld()
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const pt of FIT_POINTS) {
        p.copy(pt).project(this.camera)
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
      const dist = this.camera.position.distanceTo(this.controls.target)
      const halfH = Math.tan(vfov / 2) * dist
      const halfW = halfH * aspect
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
      const shift = right.multiplyScalar(((minX + maxX) / 2) * halfW).add(up.multiplyScalar(((minY + maxY) / 2) * halfH))
      this.controls.target.add(shift)
      this.camera.position.add(shift)
      const fill = Math.max((maxX - minX) / 2 / 0.96, (maxY - minY) / 2 / 0.9)
      const toCam = this.camera.position.clone().sub(this.controls.target)
      this.camera.position.copy(this.controls.target).addScaledVector(toCam, Math.max(0.5, fill))
    }
    this.controls.update()
  }

  // ---- materials & helpers ---------------------------------------------------------------

  private track<T extends THREE.Texture>(t: T): T {
    this.textures.push(t)
    return t
  }

  private get brushed(): THREE.Texture {
    if (!this.brushedTex) this.brushedTex = this.track(brushedRoughness())
    return this.brushedTex
  }

  private get extrusion(): THREE.MeshStandardMaterial {
    if (!this.extrusionMat) {
      this.extrusionMat = new THREE.MeshStandardMaterial({ map: this.track(extrusionMap()), metalness: 0.75, roughness: 0.48, roughnessMap: this.brushed, envMapIntensity: 0.8 })
    }
    return this.extrusionMat
  }

  private metal(color = COLORS.aluminium, roughness = 0.3): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness, roughnessMap: this.brushed })
  }

  private paint(color: number, roughness = 0.45): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness })
  }

  private rbox(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene, radius = 0.015): THREE.Mesh {
    const r = Math.min(radius, w / 2.01, h / 2.01, d / 2.01)
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private cyl(rTop: number, rBottom: number, h: number, material: THREE.Material, x: number, y: number, z: number, segments = 24, parent: THREE.Object3D = this.scene): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  /** Extrusion profile along an axis. */
  private profile(len: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, size = 0.07): THREE.Mesh {
    const w = axis === 'x' ? len : size
    const h = axis === 'y' ? len : size
    const d = axis === 'z' ? len : size
    return this.rbox(w, h, d, this.extrusion, x, y, z, this.scene, 0.008)
  }

  /** Levelling foot. */
  private foot(x: number, z: number): void {
    this.cyl(0.075, 0.085, 0.035, this.paint(0x111827, 0.8), x, 0.018, z, 20)
    this.cyl(0.018, 0.018, 0.09, this.metal(0xe5e7eb, 0.2), x, 0.08, z, 10)
  }

  // ---- building ----------------------------------------------------------------------------

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x050b14, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(-6, 12, 8)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -13
    key.shadow.camera.right = 13
    key.shadow.camera.top = 8
    key.shadow.camera.bottom = -8
    key.shadow.bias = -0.0003
    key.shadow.normalBias = 0.02
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 1.1)
    rim.position.set(9, 6, -9)
    this.scene.add(rim)
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 36),
      new THREE.MeshStandardMaterial({ map: this.track(floorMap()), metalness: 0.25, roughness: 0.5, envMapIntensity: 0.25 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    // Yellow walkway line in front of the machine.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(LINE_RIGHT - LINE_LEFT + 2, 0.08), new THREE.MeshStandardMaterial({ color: 0xd9a400, roughness: 0.6 }))
    line.rotation.x = -Math.PI / 2
    line.position.set((LINE_LEFT + LINE_RIGHT) / 2, 0.003, LAYOUT.tray_z + 1.1)
    line.receiveShadow = true
    this.scene.add(line)
  }

  /** Aluminium frame with T-slot profiles, legs with feet and braces, visible rollers, motor, belt. */
  private buildConveyor(x0: number, x1: number, beltColor: string, ribColor: string, z = 0, record = true): void {
    const length = x1 - x0
    const cx = (x0 + x1) / 2
    const top = LAYOUT.belt_y
    const beltTex = this.track(beltMap(beltColor, ribColor, length))
    const belt = this.rbox(length, 0.03, BELT_HALF * 2, new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.82, metalness: 0 }), cx, top - 0.015, z, this.scene, 0.01)
    belt.castShadow = false

    for (const side of [-1, 1]) {
      // Side frame (two stacked profiles) and a low guide rail on posts.
      this.profile(length, 'x', cx, top - 0.05, z + side * RAIL_HALF, 0.09)
      this.profile(length, 'x', cx, top - 0.16, z + side * RAIL_HALF, 0.06)
      this.profile(length, 'x', cx, top + 0.17, z + side * (BELT_HALF + 0.03), 0.025)
      for (let x = x0 + 0.35; x < x1 - 0.15; x += 1.2) this.profile(0.16, 'y', x, top + 0.08, z + side * (BELT_HALF + 0.03), 0.022)
    }

    const rollerTex = this.track(rollerMap())
    const rollerMat = new THREE.MeshStandardMaterial({ map: rollerTex, metalness: 0.85, roughness: 0.28 })
    const count = Math.max(2, Math.floor(length / ROLLER_PITCH))
    const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, RAIL_HALF * 2 - 0.02, 16), rollerMat, count)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    for (let i = 0; i < count; i++) {
      m.compose(new THREE.Vector3(x0 + (i + 0.5) * (length / count), top - 0.03 - ROLLER_R, z), q, new THREE.Vector3(1, 1, 1))
      rollers.setMatrixAt(i, m)
    }
    rollers.castShadow = true
    this.scene.add(rollers)

    // Legs with braces and feet.
    const legH = top - 0.2
    const legXs: number[] = []
    for (let x = x0 + 0.25; x <= x1 - 0.2; x += 1.8) legXs.push(x)
    if (x1 - 0.25 - (legXs[legXs.length - 1] ?? x0) > 0.7) legXs.push(x1 - 0.25)
    for (const x of legXs) {
      for (const side of [-1, 1]) {
        this.profile(legH, 'y', x, legH / 2 + 0.1, z + side * RAIL_HALF, 0.07)
        this.foot(x, z + side * RAIL_HALF)
      }
      this.profile(RAIL_HALF * 2, 'z', x, 0.24, z, 0.05)
    }

    if (record) {
      // Drive motor and gearbox at the downstream end, under the frame.
      const motor = this.cyl(0.11, 0.11, 0.32, this.paint(0x334155, 0.4), x1 - 0.35, top - 0.3, z - RAIL_HALF - 0.12, 24)
      motor.rotation.x = Math.PI / 2
      this.rbox(0.22, 0.2, 0.18, this.paint(0x1f2937, 0.5), x1 - 0.35, top - 0.3, z - RAIL_HALF - 0.36)
      this.sections.push({ x0, x1, belt: beltTex, rollers: rollerTex })
    }
  }

  /** Parallel accumulation belt behind the infeed, full of decorative bottles (scenery only). */
  private buildQueueBelt(): void {
    const x0 = LAYOUT.dispenser_x + 0.1
    const x1 = LAYOUT.turntable_x - LAYOUT.turntable_radius - 0.25
    this.buildConveyor(x0, x1, '#1b232d', '#252f3b', QUEUE_Z, false)
    const spots: THREE.Vector3[] = []
    for (let x = x0 + 0.35; x < x1 - 0.2; x += 0.55) spots.push(new THREE.Vector3(x, LAYOUT.belt_y, QUEUE_Z))
    this.addDecorBottles(this.scene, spots, 0.82)
  }

  private addDecorBottles(parent: THREE.Object3D, spots: THREE.Vector3[], scale: number): void {
    if (spots.length === 0) return
    const generic = shapeFromSilhouette(null)
    if (!this.decorGeo) this.decorGeo = latheFrom(generic.points)
    if (!this.decorGlass) {
      this.decorGlass = new THREE.MeshPhysicalMaterial({ color: 0xe7f3ff, roughness: 0.05, metalness: 0, transmission: 1, thickness: 0.04, ior: 1.45, transparent: true, opacity: 1 })
    }
    const label = new THREE.MeshStandardMaterial({ map: this.track(waveLabel('#2563eb')), transparent: true, roughness: 0.55, side: THREE.DoubleSide })
    const bandGeo = latheFrom(sliceProfile(generic.points, generic.label.y0, generic.label.y1).map((p) => ({ r: p.r * 1.015 + 0.002, y: p.y })))
    const capGeo = latheFrom([{ r: 0, y: generic.capStartY }, ...generic.points.filter((p) => p.y >= generic.capStartY - 1e-6)].map((p) => ({ r: p.r * 1.01, y: p.y })))
    const capMat = new THREE.MeshStandardMaterial({ map: this.track(capMap('#1d4ed8')), roughness: 0.4 })
    const meshes = [
      new THREE.InstancedMesh(this.decorGeo, this.decorGlass, spots.length),
      new THREE.InstancedMesh(bandGeo, label, spots.length),
      new THREE.InstancedMesh(capGeo, capMat, spots.length),
    ]
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    spots.forEach((p, i) => {
      q.setFromAxisAngle(up, ((i * 47) % 360) * (Math.PI / 180))
      m.compose(p, q, new THREE.Vector3(scale, scale, scale))
      for (const mesh of meshes) mesh.setMatrixAt(i, m)
    })
    for (const mesh of meshes) {
      mesh.castShadow = true
      parent.add(mesh)
    }
  }

  private buildDispenser(): void {
    const x = LAYOUT.dispenser_x - 0.55
    const body = this.paint(0x1f2937, 0.4)
    this.rbox(1.3, 2.5, 1.1, body, x, 1.25, -0.3, this.scene, 0.04)
    this.rbox(1.3, 0.85, 0.6, body, x, 0.425, 0.55, this.scene, 0.03)
    this.rbox(1.3, 0.22, 0.6, body, x, 2.39, 0.55, this.scene, 0.03)
    for (const side of [-1, 1]) this.rbox(0.08, 1.45, 0.6, body, x + side * 0.61, 1.57, 0.55)
    this.rbox(1.36, 0.05, 1.76, this.metal(0x9aa6b4, 0.28), x, 2.53, 0)
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9ad7ff, roughness: 0.04, transparent: true, opacity: 0.14, depthWrite: false })
    this.rbox(1.05, 1.3, 0.02, glass, x, 1.6, 0.86).castShadow = false
    this.rbox(1.14, 1.45, 0.02, this.paint(0x07182b, 0.9), x, 1.57, 0.26)
    for (const y of [1.02, 1.62]) this.rbox(1.0, 0.03, 0.5, this.metal(0x8a96a3), x, y, 0.58)
    const spots: THREE.Vector3[] = []
    for (const y of [1.04, 1.64]) for (const dx of [-0.36, -0.12, 0.12, 0.36]) spots.push(new THREE.Vector3(x + dx, y + 0.015, 0.62))
    this.addDecorBottles(this.scene, spots, 0.45)
    this.rbox(0.04, 0.42, 0.9, this.paint(0x020617, 0.9), x + 0.66, LAYOUT.belt_y + 0.24, 0)
    const led = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: COLORS.accent, emissiveIntensity: 2 })
    this.rbox(0.5, 0.06, 0.02, led, x, 2.25, 0.86)
  }

  /** Large round ORIENT table on a vented cabinet; it turns with the inspected bottle at its centre. */
  private buildTurntable(): void {
    const x = LAYOUT.turntable_x
    const R = LAYOUT.turntable_radius
    const cabinet = new THREE.MeshStandardMaterial({ map: this.track(ventPanel()), metalness: 0.4, roughness: 0.5 })
    this.rbox(1.5, 0.55, 1.5, cabinet, x, 0.3, 0, this.scene, 0.03)
    for (const dx of [-0.65, 0.65]) for (const dz of [-0.65, 0.65]) this.foot(x + dx, dz)
    this.cyl(0.18, 0.22, 0.18, this.metal(0x6b7787), x, 0.62, 0, 24)

    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.06, 72), new THREE.MeshStandardMaterial({ color: 0x2a3441, metalness: 0.7, roughness: 0.35, roughnessMap: this.brushed }))
    top.receiveShadow = true
    top.castShadow = true
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 12, 96), this.metal(0xb9c3ce, 0.35))
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.02
    const guide = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, 0.012, 8, 96), this.metal(0xd7dee6, 0.2))
    guide.rotation.x = Math.PI / 2
    guide.position.y = 0.13
    const centre = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.012, 48), this.metal(0x9aa6b4, 0.45))
    centre.position.y = 0.036
    const tickMat = new THREE.MeshBasicMaterial({ color: COLORS.accent })
    const ticks = new THREE.Group()
    for (let a = 0; a < 360; a += 30) {
      const major = a % 90 === 0
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.006, major ? 0.1 : 0.05), tickMat)
      const rad = THREE.MathUtils.degToRad(a)
      const r = 0.34 - (major ? 0.05 : 0.025)
      tick.position.set(Math.sin(rad) * r, 0.045, Math.cos(rad) * r)
      tick.rotation.y = rad
      ticks.add(tick)
    }
    this.turntableTop.add(top, rim, guide, centre, ticks)
    // Decorative bottles around the rim (they orbit when the table turns; never inspected).
    const spots: THREE.Vector3[] = []
    // Only front/back of the rim, clear of the bottle's path along x through the centre.
    for (const a of [0, 32, 148, 180, 212, 328]) {
      const rad = THREE.MathUtils.degToRad(a)
      spots.push(new THREE.Vector3(Math.sin(rad) * R * 0.86, 0.03, Math.cos(rad) * R * 0.86))
    }
    this.addDecorBottles(this.turntableTop, spots, 0.62)
    this.turntableTop.position.set(x, LAYOUT.turntable_top_y - 0.03, 0)
    this.scene.add(this.turntableTop)

    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    pointer.rotation.x = -Math.PI / 2
    pointer.position.set(x, LAYOUT.turntable_top_y + 0.06, 0.42)
    this.scene.add(pointer)

    // Locator camera on an extrusion arm behind the table.
    this.profile(1.75, 'y', x, 0.88, -R - 0.15, 0.07)
    this.profile(0.85, 'z', x, 1.72, -R + 0.27, 0.07)
    const cam = this.rbox(0.24, 0.18, 0.3, this.paint(0x0b1220, 0.35), x, 1.62, -0.42, this.scene, 0.02)
    cam.rotation.x = 0.6
    this.locatorLed = new THREE.MeshStandardMaterial({ color: 0x062530, emissive: COLORS.accent, emissiveIntensity: 0.4 })
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), this.locatorLed)
    led.position.set(x + 0.09, 1.72, -0.36)
    this.scene.add(led)
  }

  /** Inspection tower: extrusion frame, vertical LED bars, dark side panels, top camera. */
  private buildInspectTower(): void {
    const x = LAYOUT.inspect_x
    const w = 1.45
    const d = 1.35
    const h = 2.5
    for (const dx of [-w / 2, w / 2]) {
      for (const dz of [-d / 2, d / 2]) {
        this.profile(h, 'y', x + dx, h / 2, dz, 0.09)
        this.foot(x + dx, dz)
      }
    }
    for (const dz of [-d / 2, d / 2]) this.profile(w + 0.09, 'x', x, h, dz, 0.09)
    for (const dx of [-w / 2, w / 2]) this.profile(d + 0.09, 'z', x + dx, h, 0, 0.09)
    for (const dz of [-d / 2, d / 2]) this.profile(w, 'x', x, LAYOUT.belt_y + 0.32, dz, 0.05)
    this.rbox(w + 0.12, 0.08, d + 0.12, this.paint(0x1c2531, 0.5), x, h + 0.08, 0, this.scene, 0.02)
    const panel = new THREE.MeshPhysicalMaterial({ color: 0x1e3a52, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    const panelY = (h + LAYOUT.belt_y + 0.32) / 2
    const panelH = h - LAYOUT.belt_y - 0.36
    this.rbox(w - 0.05, panelH, 0.012, panel, x, panelY, -d / 2, this.scene, 0.004).castShadow = false
    for (const dx of [-w / 2, w / 2]) this.rbox(0.012, panelH, d - 0.05, panel, x + dx, panelY, 0, this.scene, 0.004).castShadow = false
    // Vertical LED bars (glow with bloom), brighter while capturing.
    for (const dx of [-w / 2 + 0.14, w / 2 - 0.14]) {
      for (const dz of [-d / 2 + 0.12, d / 2 - 0.12]) {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f6ff, emissiveIntensity: 2.2 })
        this.inspectLights.push(mat)
        this.rbox(0.05, 1.25, 0.05, mat, x + dx, 1.55, dz, this.scene, 0.02).castShadow = false
      }
    }
    // Top camera with lens and ring light.
    this.rbox(0.42, 0.34, 0.36, this.paint(0x0b1220, 0.35), x, h - 0.12, 0, this.scene, 0.03)
    this.cyl(0.085, 0.1, 0.2, this.metal(0x1f2937, 0.2), x, h - 0.38, 0)
    this.cyl(0.07, 0.07, 0.01, new THREE.MeshPhysicalMaterial({ color: 0x0b1e3a, roughness: 0, metalness: 0.2, clearcoat: 1 }), x, h - 0.485, 0)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe9ff, emissiveIntensity: 2 })
    this.inspectLights.push(ringMat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 10, 40), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, h - 0.5, 0)
    this.scene.add(ring)
    this.inspectSpot = new THREE.SpotLight(0xeaf7ff, 8, 4, Math.PI / 6, 0.55, 1.2)
    this.inspectSpot.position.set(x, h - 0.5, 0)
    this.inspectSpot.target.position.set(x, LAYOUT.belt_y, 0)
    this.scene.add(this.inspectSpot, this.inspectSpot.target)
    // Hazard stripe on the base rail.
    const hazard = new THREE.MeshStandardMaterial({ map: this.track(hazardMap()), roughness: 0.5 })
    this.rbox(w, 0.06, 0.012, hazard, x, 0.16, d / 2 + 0.05, this.scene, 0.004)
  }

  private buildPusher(x: number, color: number, plate: THREE.Group): void {
    const z = LAYOUT.pusher_rest_z - 0.62
    this.rbox(0.56, 0.4, 0.62, this.paint(color, 0.35), x, LAYOUT.belt_y + 0.2, z, this.scene, 0.04)
    this.rbox(0.5, 0.05, 0.4, this.paint(0x111827, 0.5), x, LAYOUT.belt_y + 0.42, z, this.scene, 0.01)
    const cylinder = this.cyl(0.07, 0.07, 0.5, this.metal(0xdfe5ec, 0.18), x, LAYOUT.belt_y + 0.22, z + 0.42, 20)
    cylinder.rotation.x = Math.PI / 2
    this.profile(LAYOUT.belt_y, 'y', x, LAYOUT.belt_y / 2, z, 0.08)
    this.foot(x, z)
    // Mounting bracket from the housing to the conveyor rail.
    const bracketLen = Math.abs(-RAIL_HALF - (z + 0.31))
    this.rbox(0.36, 0.06, bracketLen, this.extrusion, x, LAYOUT.belt_y - 0.08, (z + 0.31 - RAIL_HALF) / 2, this.scene, 0.008)
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.3, 0.06, 2, 0.015), this.paint(0x111827, 0.5))
    face.castShadow = true
    face.position.z = -0.03
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 12), this.metal(0xf1f5f9, 0.1))
    rod.rotation.x = Math.PI / 2
    rod.position.z = -0.68
    plate.add(face, rod)
    plate.position.set(x, LAYOUT.belt_y + 0.22, LAYOUT.pusher_rest_z)
    this.scene.add(plate)
  }

  /** Coloured chute from the belt edge into a deep tray on the near side. */
  private buildChuteAndTray(x: number, color: number): void {
    const coloured = this.paint(color, 0.35)
    const steel = this.metal(0xb8c2cd, 0.25)
    const chute = new THREE.Group()
    const len = 0.95
    this.rbox(0.72, 0.03, len, steel, 0, 0, len / 2, chute, 0.01)
    for (const side of [-1, 1]) this.rbox(0.03, 0.16, len, coloured, side * 0.37, 0.08, len / 2, chute, 0.01)
    chute.position.set(x, LAYOUT.belt_y - 0.06, RAIL_HALF + 0.02)
    chute.rotation.x = 0.36
    this.scene.add(chute)
    const tz = LAYOUT.tray_z
    const ty = LAYOUT.belt_y - 0.55
    this.rbox(1.15, 0.05, 0.95, coloured, x, ty, tz, this.scene, 0.02)
    this.rbox(1.15, 0.38, 0.05, coloured, x, ty + 0.19, tz + 0.47, this.scene, 0.02)
    for (const side of [-1, 1]) this.rbox(0.05, 0.38, 0.95, coloured, x + side * 0.57, ty + 0.19, tz, this.scene, 0.02)
    this.rbox(1.15, 0.14, 0.05, coloured, x, ty + 0.07, tz - 0.47, this.scene, 0.02)
    for (const dx of [-0.5, 0.5]) {
      for (const dz of [-0.4, 0.4]) {
        this.profile(ty, 'y', x + dx, ty / 2, tz + dz, 0.05)
        this.foot(x + dx, tz + dz)
      }
    }
  }

  private buildPassEnd(): void {
    const x = LAYOUT.pass_end_x + 0.75
    this.rbox(0.06, 0.3, BELT_HALF * 2 + 0.2, this.paint(COLORS.pass, 0.35), x, LAYOUT.belt_y + 0.12, 0, this.scene, 0.02)
    const post = new THREE.MeshStandardMaterial({ color: 0x0b3b22, emissive: COLORS.pass, emissiveIntensity: 1.6 })
    for (const side of [-1, 1]) this.rbox(0.05, 0.55, 0.05, post, LAYOUT.pass_gate_x + 0.3, LAYOUT.belt_y + 0.27, side * (RAIL_HALF + 0.06), this.scene, 0.01)
  }

  /** Three-colour stack light on the inspection tower: shows the machine state, not a verdict. */
  private buildStackLight(): void {
    const x = LAYOUT.inspect_x + 0.72
    const z = -0.67
    const base = 2.62
    this.cyl(0.05, 0.05, 0.08, this.paint(0x111827), x, base, z, 16)
    const lamps: Array<[THREE.MeshStandardMaterial, number]> = [
      [this.stack.green, base + 0.11],
      [this.stack.yellow, base + 0.24],
      [this.stack.red, base + 0.37],
    ]
    for (const [mat, y] of lamps) this.cyl(0.055, 0.055, 0.12, mat, x, y, z, 20)
    this.cyl(0.05, 0.05, 0.03, this.paint(0x111827), x, base + 0.45, z, 16)
  }

  private updateStackLight(state: Readonly<MachineState>): void {
    const s = this.stack
    s.green.emissiveIntensity = 0
    s.yellow.emissiveIntensity = 0
    s.red.emissiveIntensity = 0
    if (state.phase === 'ERROR') s.red.emissiveIntensity = 4
    else if (state.paused || state.phase === 'WAIT_RESULT') s.yellow.emissiveIntensity = 4
    else if (state.phase !== 'IDLE' && state.phase !== 'COMPLETE') s.green.emissiveIntensity = 4
  }

  /** Call-out badges with a leader line and a dot on the station, as in the reference. */
  private buildCallouts(): void {
    const items: Array<[string, number, number, number, string, string]> = [
      ['FEED', LAYOUT.dispenser_x + 1.2, LAYOUT.belt_y + 0.3, 2.4, '#e6f6ff', 'rgba(9,40,72,0.95)'],
      ['ORIENT', LAYOUT.turntable_x, LAYOUT.turntable_top_y + 0.1, 2.7, '#e6f6ff', 'rgba(9,40,72,0.95)'],
      ['INSPECT', LAYOUT.inspect_x, 2.62, 3.45, '#e6f6ff', 'rgba(9,40,72,0.95)'],
      ['REJECT', LAYOUT.reject_x, LAYOUT.belt_y + 0.45, 2.3, '#ffffff', 'rgba(127,20,20,0.95)'],
      ['REVIEW', LAYOUT.review_x, LAYOUT.belt_y + 0.45, 2.3, '#1f1300', 'rgba(245,179,1,0.95)'],
      ['PASS', LAYOUT.pass_end_x - 0.4, LAYOUT.belt_y + 0.1, 1.95, '#ffffff', 'rgba(21,128,61,0.95)'],
    ]
    const z = -0.85
    const lineMat = new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.9 })
    const dotGeo = new THREE.SphereGeometry(0.035, 12, 8)
    const dotMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, emissive: COLORS.accent, emissiveIntensity: 1.6 })
    for (const [text, x, anchorY, y, color, bg] of items) {
      const sprite = this.makeSprite(text, color, bg, 1.05)
      sprite.position.set(x, y, z)
      this.scene.add(sprite)
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y - 0.14, z), new THREE.Vector3(x, anchorY + 0.06, z)])
      this.scene.add(new THREE.Line(geo, lineMat))
      const dot = new THREE.Mesh(dotGeo, dotMat)
      dot.position.set(x, anchorY + 0.06, z)
      this.scene.add(dot)
    }
  }

  // ---- inspected bottle ---------------------------------------------------------------------

  private buildBottle(): void {
    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xeaf5ff, roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.05, ior: 1.46, transparent: true, clearcoat: 1, clearcoatRoughness: 0.05 })
    this.capMat = new THREE.MeshStandardMaterial({ map: this.track(capMap('#1d4ed8')), roughness: 0.38 })
    const labelMat = new THREE.MeshStandardMaterial({ map: this.track(waveLabel(PRODUCT_ACCENT.bottle_a ?? '#1d4ed8')), transparent: true, roughness: 0.5, side: THREE.DoubleSide })
    this.labelBand = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.BufferGeometry(), labelMat)
    this.water = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>(
      new THREE.BufferGeometry(),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, roughness: 0.02, metalness: 0, transmission: 0.9, thickness: 0.3, ior: 1.33, transparent: true, attenuationColor: new THREE.Color(0x9fd4ff), attenuationDistance: 1.2 }),
    )
    this.bottle.add(this.bottleSpin)
    this.bottle.visible = false
    this.scene.add(this.bottle)
    this.applyShape(shapeFromSilhouette(null))
  }

  private applyShape(spec: BottleShapeSpec): void {
    this.shape = spec
    for (const child of [...this.bottleSpin.children]) {
      this.bottleSpin.remove(child)
      if (child !== this.labelBand && child !== this.water) (child as THREE.Mesh).geometry?.dispose()
    }
    const bodyPts = spec.points.filter((p) => p.y <= spec.capStartY + 1e-6).concat([{ r: 0, y: spec.capStartY }])
    const body = new THREE.Mesh(latheFrom(bodyPts), this.bodyMat)
    body.castShadow = true
    const capPts = [{ r: 0, y: spec.capStartY }, ...spec.points.filter((p) => p.y >= spec.capStartY - 1e-6)].map((p) => ({ r: p.r * 1.006, y: p.y }))
    const cap = new THREE.Mesh(latheFrom(capPts), this.capMat)
    cap.castShadow = true
    const bandPts = sliceProfile(spec.points, spec.label.y0, spec.label.y1).map((p) => ({ r: p.r * 1.012 + 0.002, y: p.y }))
    this.labelBand.geometry.dispose()
    this.labelBand.geometry = latheFrom(bandPts)
    // Water fills ~70 % of the body, slightly inside the wall.
    const fill = Math.min(spec.height * 0.7, spec.capStartY - 0.05)
    const waterPts = sliceProfile(spec.points, 0.02, fill).map((p) => ({ r: Math.max(0, p.r * 0.94 - 0.006), y: p.y }))
    this.water.geometry.dispose()
    this.water.geometry = latheFrom([{ r: 0, y: waterPts[0]?.y ?? 0.02 }, ...waterPts, { r: 0, y: waterPts[waterPts.length - 1]?.y ?? fill }])
    this.bottleSpin.add(body, this.water, cap, this.labelBand)
    this.activeRing.scale.setScalar(Math.max(0.6, spec.maxRadius / LAYOUT.bottle_radius))
  }

  private syncProduct(productId: string): void {
    if (productId === this.productKey) return
    this.productKey = productId
    const accent = PRODUCT_ACCENT[productId] ?? '#475569'
    const old = this.labelBand.material.map
    this.labelBand.material.map = this.track(waveLabel(accent))
    this.labelBand.material.needsUpdate = true
    old?.dispose()
  }

  private updateTag(state: Readonly<MachineState>, pose: Pose): void {
    const verdict = state.result?.result
    const show = !!verdict && ['SORT', 'OUTPUT', 'COMPLETE'].includes(state.phase)
    this.tag.visible = show && this.bottle.visible
    if (!show || !verdict) return
    const key = `${verdict}:${state.result?.reason}`
    if (key !== this.tagKey) {
      this.tagKey = key
      this.drawSprite(this.tag, verdict, '#041326', VERDICT_COLORS[verdict])
    }
    this.tag.position.set(pose.x, pose.y + this.shape.height + 0.35, pose.z + 0.25)
  }

  // ---- sprites ------------------------------------------------------------------------------

  private makeSprite(text: string, color: string, background: string, width: number): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 256
    const texture = this.track(new THREE.CanvasTexture(c))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }))
    // Draw labels after the other transparent parts (floor grid, glass) so no line crosses the text.
    sprite.renderOrder = 10
    sprite.scale.set(width, width / 4, 1)
    this.drawSprite(sprite, text, color, background)
    return sprite
  }

  private drawSprite(sprite: THREE.Sprite, text: string, color: string, background: string): void {
    const texture = sprite.material.map as THREE.CanvasTexture
    const c = texture.image as HTMLCanvasElement
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, c.width, c.height)
    g.fillStyle = background
    roundRect(g, 12, 28, c.width - 24, c.height - 56, 40)
    g.fill()
    g.strokeStyle = 'rgba(18,213,245,0.95)'
    g.lineWidth = 8
    g.stroke()
    g.fillStyle = color
    g.font = "800 112px system-ui, 'Noto Sans Thai', 'Leelawadee UI', sans-serif"
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 80)
    texture.needsUpdate = true
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function latheFrom(points: Array<{ r: number; y: number }>): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(Math.max(0, p.r), p.y)), 48)
}

/** Outline between y0 and y1 (bottom → top), with interpolated end points. */
function sliceProfile(points: Array<{ r: number; y: number }>, y0: number, y1: number): Array<{ r: number; y: number }> {
  const body = points.filter((p) => p.r > 0)
  const at = (y: number) => {
    for (let i = 1; i < body.length; i++) {
      const a = body[i - 1]
      const b = body[i]
      if (a && b && y >= a.y && y <= b.y) return a.r + ((b.r - a.r) * (y - a.y)) / Math.max(1e-9, b.y - a.y)
    }
    return body[0]?.r ?? 0
  }
  return [{ r: at(y0), y: y0 }, ...body.filter((p) => p.y > y0 && p.y < y1), { r: at(y1), y: y1 }]
}

/** True when a WebGL context can be created; otherwise the host shows the 2D fallback. */
export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    const ok = !!gl
    ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
}
