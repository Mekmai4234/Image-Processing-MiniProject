import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { InspectionVerdict } from '../api/contract'
import { LAYOUT, poseOf, type Pose } from '../machine/motion'
import type { MachineState } from '../machine/types'
import { shapeFromSilhouette, type BottleShapeSpec } from '../shape/bottleShape'

export interface ConveyorSceneOptions {
  reducedMotion?: boolean
}

/** Shared design tokens of the team (00-ข้อตกลงร่วม): navy background, cyan accent. */
const COLORS = {
  background: 0x041326,
  floor: 0x06182c,
  grid: 0x0f3355,
  aluminium: 0xc9d2dc,
  steelDark: 0x3b4756,
  belt: '#1a222d',
  beltStripe: '#26313f',
  passBelt: '#0f5a2e',
  passStripe: '#167a3f',
  pass: 0x22c55e,
  reject: 0xef4444,
  review: 0xf5b301,
  accent: 0x12d5f5,
}

const PRODUCT_COLORS: Record<string, number> = { bottle_a: 0x2563eb, bottle_b: 0x16a34a }
const VERDICT_COLORS: Record<InspectionVerdict, string> = { PASS: '#22c55e', FAIL: '#ef4444', REVIEW: '#f5b301' }

const BELT_HALF_WIDTH = 0.5
const RAIL_HALF = BELT_HALF_WIDTH + 0.07
const BOTTLE_HEIGHT = 1.05
const ROLLER_RADIUS = 0.055
const ROLLER_PITCH = 0.24
const SIGN_Z = -1.75
const LINE_LEFT = LAYOUT.dispenser_x - 1.5
const LINE_RIGHT = LAYOUT.pass_end_x + 1.1
const VIEW_TARGET = new THREE.Vector3((LINE_LEFT + LINE_RIGHT) / 2 + 0.4, 0.6, 0.2)
const VIEW_DIRECTION = new THREE.Vector3(-0.32, 0.6, 0.73).normalize()
/** Points that must stay inside the frame: line ends, sign tops and the trays. */
const FIT_POINTS = [
  new THREE.Vector3(LINE_LEFT, 0, -1.9), new THREE.Vector3(LINE_LEFT, 3.3, -1.9), new THREE.Vector3(LINE_LEFT, 0, 1.0),
  new THREE.Vector3(LINE_RIGHT, 0, -1.9), new THREE.Vector3(LINE_RIGHT, 2.6, -1.9), new THREE.Vector3(LINE_RIGHT, 0, 1.0),
  new THREE.Vector3(LAYOUT.review_x + 0.7, 0, LAYOUT.tray_z + 0.6), new THREE.Vector3(LAYOUT.reject_x - 0.7, 0, LAYOUT.tray_z + 0.6),
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
 * Decorative bottles in the dispenser are scenery only; they never create inspections.
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

  private readonly bottle = new THREE.Group()
  /** Inner group spun by the turntable angle; the outer group carries position and tilt. */
  private readonly bottleSpin = new THREE.Group()
  private labelBand!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  private activeRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private bodyMat!: THREE.MeshPhysicalMaterial
  private capMat!: THREE.MeshStandardMaterial
  private shape!: BottleShapeSpec
  private readonly turntableTop = new THREE.Group()
  private readonly rejectPlate = new THREE.Group()
  private readonly reviewPlate = new THREE.Group()
  private readonly inspectLights: THREE.MeshStandardMaterial[] = []
  private inspectSpot!: THREE.SpotLight
  private locatorLed!: THREE.MeshStandardMaterial
  private readonly sections: ConveyorSection[] = []
  private readonly tag: THREE.Sprite
  private tagKey = ''
  private productKey = ''
  private lastPose: Pose | null = null
  private clock = 0
  private disposed = false

  constructor(private readonly container: HTMLElement, options: ConveyorSceneOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const canvas = this.renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    // Soft studio reflections so metal reads as metal.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.envTexture = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.envTexture
    this.scene.environmentIntensity = 0.55
    this.scene.background = new THREE.Color(COLORS.background)
    this.scene.fog = new THREE.Fog(COLORS.background, 24, 46)

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 120)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.copy(VIEW_TARGET)
    this.controls.enableDamping = !this.reducedMotion
    this.controls.minDistance = 5
    this.controls.maxDistance = 34
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.enablePan = false

    this.buildLights()
    this.buildFloor()
    this.buildConveyor(LAYOUT.dispenser_x - 0.9, LAYOUT.turntable_x - 0.62, COLORS.belt, COLORS.beltStripe)
    this.buildConveyor(LAYOUT.turntable_x + 0.62, LAYOUT.pass_gate_x + 0.3, COLORS.belt, COLORS.beltStripe)
    this.buildConveyor(LAYOUT.pass_gate_x + 0.3, LAYOUT.pass_end_x + 0.7, COLORS.passBelt, COLORS.passStripe)
    this.buildDispenser()
    this.buildTurntable()
    this.buildInspectEnclosure()
    this.buildPusher(LAYOUT.reject_x, COLORS.reject, this.rejectPlate)
    this.buildPusher(LAYOUT.review_x, COLORS.review, this.reviewPlate)
    this.buildChuteAndTray(LAYOUT.reject_x, COLORS.reject)
    this.buildChuteAndTray(LAYOUT.review_x, COLORS.review)
    this.buildPassEnd()
    this.buildSigns()
    const r = LAYOUT.bottle_radius
    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(r + 0.06, r + 0.11, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.activeRing.rotation.x = -Math.PI / 2
    this.activeRing.visible = false
    this.scene.add(this.activeRing)
    this.buildBottle()
    this.tag = this.makeSprite(' ', '#ffffff', 'rgba(4,19,38,0.85)', 1.4)
    this.tag.visible = false
    this.scene.add(this.tag)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    liveInstances += 1
  }

  render(state: Readonly<MachineState>, realDtSeconds: number): void {
    if (this.disposed) return
    this.clock += realDtSeconds
    const pose = poseOf(state as MachineState)
    const animate = !this.reducedMotion

    this.syncProduct(state.job?.expected_product ?? '')
    this.bottle.visible = pose.visible
    this.bottle.position.set(pose.x, pose.y, pose.z)
    this.bottle.rotation.x = pose.tilt
    this.bottleSpin.rotation.y = THREE.MathUtils.degToRad(-pose.angle_deg)
    if (pose.station === 'turntable') this.turntableTop.rotation.y = this.bottleSpin.rotation.y

    // Belt and rollers move exactly as far as the bottle riding on them, and only that section.
    const prev = this.lastPose
    if (animate && prev && prev.visible && pose.station === 'belt' && prev.station !== 'none') {
      const dx = pose.x - prev.x
      if (dx !== 0) {
        for (const section of this.sections) {
          if (pose.x < section.x0 - 0.05 || pose.x > section.x1 + 0.05) continue
          section.belt.offset.x -= dx
          section.rollers.offset.x -= dx / (2 * Math.PI * ROLLER_RADIUS)
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
    for (const m of this.inspectLights) m.emissiveIntensity = 1.4 + flash * 5
    this.inspectSpot.intensity = 6 + flash * 60
    const pulse = pose.locating ? (animate ? 0.6 + 0.4 * Math.sin(this.clock * 8) : 1) : 0.15
    this.locatorLed.emissiveIntensity = 2.5 * pulse

    // Mark the bottle being inspected so it can't be confused with scenery.
    this.activeRing.visible = pose.visible && (pose.station === 'belt' || pose.station === 'turntable' || pose.station === 'inspect')
    if (this.activeRing.visible) {
      this.activeRing.position.set(pose.x, pose.y + 0.012, pose.z)
      this.activeRing.material.opacity = animate ? 0.55 + 0.25 * Math.sin(this.clock * 3) : 0.7
    }

    this.updateTag(state, pose)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  /** Releases every GPU resource and listener. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    this.controls.dispose()
    const textures = new Set<THREE.Texture>([this.envTexture])
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
    for (const texture of textures) texture.dispose()
    this.scene.environment = null
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    liveInstances -= 1
  }

  // ---- framing -------------------------------------------------------------------------

  private resize(): void {
    // Re-framing on resize resets any orbit the user made; acceptable for a fixed-layout panel.
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    this.camera.aspect = aspect
    this.camera.fov = aspect < 1.2 ? 46 : 30
    this.camera.updateProjectionMatrix()
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    // Fit the whole machine for this aspect ratio so resizing never cuts it: binary-search the
    // camera distance until every fit point projects inside the frame.
    let lo = 4
    let hi = this.controls.maxDistance
    const p = new THREE.Vector3()
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
    this.controls.target.copy(VIEW_TARGET)
    // Centre the machine in the frame (the diagonal view leaves uneven margins), then move
    // closer so it fills the viewport. Keeps the same viewing direction.
    for (let pass = 0; pass < 3; pass++) {
      this.camera.lookAt(this.controls.target)
      this.camera.updateMatrixWorld()
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const pt of FIT_POINTS) {
        p.copy(pt).project(this.camera)
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      }
      const dist = this.camera.position.distanceTo(this.controls.target)
      const halfH = Math.tan(vfov / 2) * dist
      const halfW = halfH * aspect
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
      const shift = right.multiplyScalar(((minX + maxX) / 2) * halfW).add(up.multiplyScalar(((minY + maxY) / 2) * halfH))
      this.controls.target.add(shift)
      this.camera.position.add(shift)
      const fill = Math.max((maxX - minX) / 2 / 0.95, (maxY - minY) / 2 / 0.9)
      const toCam = this.camera.position.clone().sub(this.controls.target)
      this.camera.position.copy(this.controls.target).addScaledVector(toCam, Math.max(0.5, fill))
    }
    this.controls.update()
  }

  // ---- materials & helpers ---------------------------------------------------------------

  private aluminium(color = COLORS.aluminium, roughness = 0.32): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness })
  }

  private plastic(color: number, roughness = 0.45): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness })
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private cylinder(rTop: number, rBottom: number, h: number, material: THREE.Material, x: number, y: number, z: number, segments = 24): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  private stripeTexture(color: string, stripe: string, repeat: number, stripeWidth = 3): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 128, 32)
      ctx.fillStyle = stripe
      for (let x = 0; x < 128; x += 16) ctx.fillRect(x, 0, stripeWidth, 32)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat, 1)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return texture
  }

  // ---- building ----------------------------------------------------------------------------

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x08111c, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(-5, 11, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 1024)
    key.shadow.camera.left = -12
    key.shadow.camera.right = 12
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.9)
    rim.position.set(8, 5, -8)
    this.scene.add(rim)
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 34),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, metalness: 0, roughness: 0.92, envMapIntensity: 0.15 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    const grid = new THREE.GridHelper(60, 60, COLORS.grid, COLORS.grid)
    const gridMat = grid.material as THREE.LineBasicMaterial
    gridMat.transparent = true
    gridMat.opacity = 0.45
    grid.position.y = 0.002
    this.scene.add(grid)
  }

  /** Aluminium frame, legs with feet and braces, visible rollers, and a belt that tracks the bottle. */
  private buildConveyor(x0: number, x1: number, beltColor: string, stripeColor: string): void {
    const length = x1 - x0
    const cx = (x0 + x1) / 2
    const top = LAYOUT.belt_y
    const beltTexture = this.stripeTexture(beltColor, stripeColor, length)
    const belt = this.box(length, 0.04, BELT_HALF_WIDTH * 2, new THREE.MeshStandardMaterial({ map: beltTexture, roughness: 0.85 }), cx, top - 0.02, 0)
    belt.castShadow = false

    // Side rails: extruded profile with a darker slot line.
    const rail = this.aluminium()
    const slot = this.aluminium(COLORS.steelDark, 0.5)
    for (const side of [-1, 1]) {
      this.box(length, 0.17, 0.07, rail, cx, top - 0.06, side * RAIL_HALF)
      this.box(length, 0.025, 0.072, slot, cx, top - 0.07, side * RAIL_HALF)
      // low guide rail that keeps the bottle on the belt
      this.box(length, 0.025, 0.025, rail, cx, top + 0.16, side * (BELT_HALF_WIDTH + 0.02))
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 1.4) this.box(0.025, 0.16, 0.025, rail, x, top + 0.08, side * (BELT_HALF_WIDTH + 0.02))
    }

    // Rollers under the belt; their ends show between the rails. One shared striped texture spins them all.
    const rollerTexture = this.stripeTexture('#aab6c3', '#6b7684', 1, 6)
    const rollerMat = new THREE.MeshStandardMaterial({ map: rollerTexture, metalness: 0.8, roughness: 0.3 })
    const count = Math.max(2, Math.floor(length / ROLLER_PITCH))
    const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(ROLLER_RADIUS, ROLLER_RADIUS, RAIL_HALF * 2 + 0.02, 16), rollerMat, count)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    for (let i = 0; i < count; i++) {
      const x = x0 + (i + 0.5) * (length / count)
      m.compose(new THREE.Vector3(x, top - 0.04 - ROLLER_RADIUS, 0), q, new THREE.Vector3(1, 1, 1))
      rollers.setMatrixAt(i, m)
    }
    rollers.castShadow = true
    this.scene.add(rollers)

    // End drums.
    for (const x of [x0 + 0.06, x1 - 0.06]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, BELT_HALF_WIDTH * 2 + 0.04, 24), rollerMat)
      drum.rotation.x = Math.PI / 2
      drum.position.set(x, top - 0.06, 0)
      this.scene.add(drum)
    }

    // Legs every ~2 m with feet and cross braces.
    const leg = this.aluminium(0xaeb8c4)
    const foot = this.plastic(0x1f2937, 0.7)
    const legH = top - 0.15
    const legXs: number[] = []
    for (let x = x0 + 0.3; x <= x1 - 0.25; x += 2.0) legXs.push(x)
    if (legXs.length === 0 || x1 - 0.3 - (legXs[legXs.length - 1] ?? x0) > 0.8) legXs.push(x1 - 0.3)
    for (const x of legXs) {
      for (const side of [-1, 1]) {
        this.box(0.07, legH, 0.07, leg, x, legH / 2, side * RAIL_HALF)
        this.cylinder(0.07, 0.08, 0.04, foot, x, 0.02, side * RAIL_HALF, 16)
      }
      this.box(0.05, 0.05, RAIL_HALF * 2, leg, x, 0.2, 0)
    }
    this.sections.push({ x0, x1, belt: beltTexture, rollers: rollerTexture })
  }

  private buildDispenser(): void {
    const x = LAYOUT.dispenser_x - 0.55
    const body = this.plastic(0x1e293b, 0.4)
    const trim = this.aluminium(0x6b7787, 0.35)
    // Machine body behind, open display compartment in front (towards the viewer).
    this.box(1.3, 2.5, 1.1, body, x, 1.25, -0.3)
    this.box(1.3, 0.85, 0.6, body, x, 0.425, 0.55)
    this.box(1.3, 0.22, 0.6, body, x, 2.39, 0.55)
    for (const side of [-1, 1]) this.box(0.08, 1.45, 0.6, body, x + side * 0.61, 1.57, 0.55)
    this.box(1.34, 0.06, 1.74, trim, x, 2.53, 0)
    this.box(1.34, 0.06, 1.74, trim, x, 0.03, 0)
    // Glass front (facing the viewer) showing queued bottles — scenery only, never inspected.
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9ad7ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false })
    const pane = this.box(1.05, 1.3, 0.02, glass, x, 1.6, 0.86)
    pane.castShadow = false
    this.box(1.14, 1.45, 0.02, new THREE.MeshStandardMaterial({ color: 0x07182b, roughness: 0.9 }), x, 1.57, 0.26)
    const shelfMat = this.aluminium(0x8a96a3)
    for (const y of [1.02, 1.62]) this.box(1.0, 0.03, 0.5, shelfMat, x, y, 0.58)
    const decorGeo = this.bottleGeometry()
    const decorMat = new THREE.MeshPhysicalMaterial({ color: 0xbfdcf5, roughness: 0.15, transparent: true, opacity: 0.5 })
    const capMat = this.plastic(0x1d4ed8)
    for (const y of [1.04, 1.64]) {
      for (const dx of [-0.36, -0.12, 0.12, 0.36]) {
        const decor = new THREE.Mesh(decorGeo, decorMat)
        decor.scale.setScalar(0.48)
        decor.position.set(x + dx, y + 0.015, 0.62)
        this.scene.add(decor)
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 12), capMat)
        cap.position.set(x + dx, y + 0.015 + BOTTLE_HEIGHT * 0.48 * 0.97 + 0.026, 0.62)
        this.scene.add(cap)
      }
    }
    // Outlet slot onto the belt.
    this.box(0.04, 0.42, 0.9, new THREE.MeshStandardMaterial({ color: 0x020617 }), x + 0.66, LAYOUT.belt_y + 0.24, 0)
    // Status light.
    const led = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: COLORS.accent, emissiveIntensity: 1.2 })
    this.box(0.04, 0.08, 0.5, led, x + 0.66, 2.3, 0)
  }

  private buildTurntable(): void {
    const x = LAYOUT.turntable_x
    this.cylinder(0.62, 0.7, 0.62, this.aluminium(0x7d8896, 0.4), x, 0.31, 0, 48)
    this.cylinder(0.66, 0.66, 0.05, this.aluminium(), x, LAYOUT.belt_y + 0.0, 0, 48)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.04, 48), this.aluminium(0xdde3ea, 0.25))
    top.receiveShadow = true
    // Angle ticks every 30°, longer at 0/90/180/270.
    const tickMat = new THREE.MeshBasicMaterial({ color: COLORS.accent })
    const ticks = new THREE.Group()
    for (let a = 0; a < 360; a += 30) {
      const major = a % 90 === 0
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, major ? 0.12 : 0.06), tickMat)
      const r = 0.58 - (major ? 0.06 : 0.03)
      const rad = THREE.MathUtils.degToRad(a)
      tick.position.set(Math.sin(rad) * r, 0.024, Math.cos(rad) * r)
      tick.rotation.y = rad
      ticks.add(tick)
    }
    this.turntableTop.add(top, ticks)
    this.turntableTop.position.set(x, LAYOUT.turntable_top_y - 0.02, 0)
    this.scene.add(this.turntableTop)
    // Fixed pointer at the front edge shows the current angle against the ticks.
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    pointer.rotation.x = -Math.PI / 2
    pointer.position.set(x, LAYOUT.turntable_top_y + 0.01, 0.68)
    this.scene.add(pointer)

    // Locator camera on an arm behind the turntable.
    const arm = this.aluminium()
    this.box(0.07, 1.55, 0.07, arm, x, 0.78 + 0.0, -0.95)
    this.box(0.07, 0.07, 0.62, arm, x, 1.55, -0.68)
    const cam = this.box(0.26, 0.2, 0.3, this.plastic(0x111827, 0.35), x, 1.48, -0.35)
    cam.rotation.x = 0.55
    this.locatorLed = new THREE.MeshStandardMaterial({ color: 0x062530, emissive: COLORS.accent, emissiveIntensity: 0.4 })
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), this.locatorLed)
    led.position.set(x + 0.09, 1.6, -0.3)
    this.scene.add(led)
  }

  /** Inspection enclosure: open front so the bottle stays visible, LED bars, camera on top. */
  private buildInspectEnclosure(): void {
    const x = LAYOUT.inspect_x
    const w = 1.5
    const d = 1.5
    const h = 2.35
    const frame = this.aluminium()
    for (const dx of [-w / 2, w / 2]) for (const dz of [-d / 2, d / 2]) this.box(0.08, h, 0.08, frame, x + dx, h / 2, dz)
    for (const dz of [-d / 2, d / 2]) this.box(w + 0.08, 0.08, 0.08, frame, x, h, dz)
    for (const dx of [-w / 2, w / 2]) this.box(0.08, 0.08, d + 0.08, frame, x + dx, h, 0)
    // Roof and translucent back/side panels.
    this.box(w + 0.1, 0.06, d + 0.1, this.plastic(0x1f2a37, 0.5), x, h + 0.06, 0)
    const panel = new THREE.MeshPhysicalMaterial({ color: 0x8fd3ff, roughness: 0.1, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    const back = this.box(w, h - 0.1, 0.01, panel, x, h / 2, -d / 2)
    back.castShadow = false
    for (const dx of [-w / 2, w / 2]) {
      const side = this.box(0.01, h - 0.1, d, panel, x + dx, h / 2, 0)
      side.castShadow = false
    }
    // LED bars inside, brighter while capturing.
    for (const dx of [-w / 2 + 0.12, w / 2 - 0.12]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xeaf8ff, emissive: 0xdff4ff, emissiveIntensity: 1.4 })
      this.inspectLights.push(mat)
      const bar = this.box(0.05, 1.2, 0.12, mat, x + dx, 1.35, -0.25)
      bar.castShadow = false
    }
    // Top camera with ring light.
    this.box(0.4, 0.28, 0.34, this.plastic(0x0b1220, 0.35), x, h - 0.2, 0)
    this.cylinder(0.08, 0.1, 0.16, this.aluminium(0x1f2937, 0.2), x, h - 0.42, 0)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x7dd3fc, emissiveIntensity: 1.2 })
    this.inspectLights.push(ringMat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 36), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, h - 0.5, 0)
    this.scene.add(ring)
    this.inspectSpot = new THREE.SpotLight(0xe8f6ff, 6, 4, Math.PI / 6, 0.55, 1.2)
    this.inspectSpot.position.set(x, h - 0.5, 0)
    this.inspectSpot.target.position.set(x, LAYOUT.belt_y, 0)
    this.scene.add(this.inspectSpot, this.inspectSpot.target)
  }

  private buildPusher(x: number, color: number, plate: THREE.Group): void {
    const z = LAYOUT.pusher_rest_z - 0.6
    this.box(0.55, 0.42, 0.55, this.plastic(0x2b3644, 0.45), x, LAYOUT.belt_y + 0.2, z)
    this.box(0.57, 0.07, 0.57, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }), x, LAYOUT.belt_y + 0.44, z)
    this.box(0.08, LAYOUT.belt_y, 0.08, this.aluminium(0xaeb8c4), x, LAYOUT.belt_y / 2, z)
    // Mounting bracket from the housing to the conveyor rail.
    this.box(0.36, 0.06, -RAIL_HALF - (z + 0.27), this.aluminium(0xaeb8c4), x, LAYOUT.belt_y - 0.08, (z + 0.27 - RAIL_HALF) / 2)
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.06), this.plastic(color, 0.4))
    face.castShadow = true
    face.position.z = -0.03
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 12), this.aluminium(0xe5e7eb, 0.15))
    rod.rotation.x = Math.PI / 2
    rod.position.z = -0.68
    plate.add(face, rod)
    plate.position.set(x, LAYOUT.belt_y + 0.22, LAYOUT.pusher_rest_z)
    this.scene.add(plate)
  }

  /** Open chute from the belt edge down into a coloured tray on the near side. */
  private buildChuteAndTray(x: number, color: number): void {
    const coloured = this.plastic(color, 0.4)
    const steel = this.aluminium(0xb8c2cd, 0.3)
    const chute = new THREE.Group()
    const len = 0.95
    this.box(0.75, 0.03, len, steel, 0, 0, len / 2, chute)
    for (const side of [-1, 1]) this.box(0.03, 0.14, len, coloured, side * 0.38, 0.07, len / 2, chute)
    chute.position.set(x, LAYOUT.belt_y - 0.06, RAIL_HALF + 0.02)
    chute.rotation.x = 0.36
    this.scene.add(chute)

    const tz = LAYOUT.tray_z
    const ty = LAYOUT.belt_y - 0.55
    this.box(1.15, 0.05, 0.95, coloured, x, ty, tz)
    this.box(1.15, 0.36, 0.05, coloured, x, ty + 0.18, tz + 0.47)
    for (const side of [-1, 1]) this.box(0.05, 0.36, 0.95, coloured, x + side * 0.57, ty + 0.18, tz)
    this.box(1.15, 0.12, 0.05, coloured, x, ty + 0.06, tz - 0.47)
    const leg = this.aluminium(0xaeb8c4)
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.4, 0.4]) this.box(0.05, ty, 0.05, leg, x + dx, ty / 2, tz + dz)
  }

  private buildPassEnd(): void {
    const x = LAYOUT.pass_end_x + 0.75
    const stop = this.plastic(COLORS.pass, 0.4)
    this.box(0.06, 0.3, BELT_HALF_WIDTH * 2 + 0.2, stop, x, LAYOUT.belt_y + 0.12, 0)
    // Light curtain posts at the PASS gate.
    const post = new THREE.MeshStandardMaterial({ color: 0x0b3b22, emissive: COLORS.pass, emissiveIntensity: 0.8 })
    for (const side of [-1, 1]) this.box(0.05, 0.55, 0.05, post, LAYOUT.pass_gate_x + 0.3, LAYOUT.belt_y + 0.27, side * (RAIL_HALF + 0.06))
  }

  /** Station signs stand behind the line on thin poles, so they never cover the bottle or cameras. */
  private buildSigns(): void {
    const signs: Array<[string, number, string, string, number]> = [
      ['FEED', LAYOUT.dispenser_x - 0.55, '#e6f6ff', 'rgba(9,29,53,0.95)', 3.05],
      ['ORIENT', LAYOUT.turntable_x, '#e6f6ff', 'rgba(9,29,53,0.95)', 2.55],
      ['INSPECT', LAYOUT.inspect_x, '#e6f6ff', 'rgba(9,29,53,0.95)', 3.05],
      ['REJECT', LAYOUT.reject_x, '#ffffff', 'rgba(185,28,28,0.95)', 2.3],
      ['REVIEW · ถ่ายใหม่', LAYOUT.review_x, '#1f1300', 'rgba(245,179,1,0.95)', 2.3],
      ['PASS', LAYOUT.pass_end_x - 0.3, '#ffffff', 'rgba(21,128,61,0.95)', 2.3],
    ]
    const poleMat = this.aluminium(0x8a96a3)
    for (const [text, x, color, bg, y] of signs) {
      const sprite = this.makeSprite(text, color, bg, text.length > 8 ? 2.3 : 1.6)
      sprite.position.set(x, y, SIGN_Z)
      this.scene.add(sprite)
      this.cylinder(0.018, 0.018, y - 0.12, poleMat, x, (y - 0.12) / 2, SIGN_Z - 0.02, 8)
    }
  }

  /** Generic bottle geometry for decorative bottles (never the inspected one). */
  private bottleGeometry(): THREE.LatheGeometry {
    return latheFrom(shapeFromSilhouette(null).points)
  }

  private buildBottle(): void {
    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd6ecff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 })
    this.capMat = this.plastic(0x1d4ed8, 0.4)
    const labelMat = new THREE.MeshStandardMaterial({ map: this.labelTexture(), roughness: 0.6, side: THREE.DoubleSide })
    this.labelBand = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.BufferGeometry(), labelMat)
    this.bottle.add(this.bottleSpin)
    this.bottle.visible = false
    this.scene.add(this.bottle)

    this.applyShape(shapeFromSilhouette(null))
  }

  /**
   * Rebuilds the inspected bottle from a shape spec (silhouette or generic fallback). The label
   * band follows the body outline on its straightest section. Old geometry is disposed.
   */
  setBottleShape(spec: BottleShapeSpec): void {
    if (this.disposed || spec === this.shape) return
    this.applyShape(spec)
  }

  private applyShape(spec: BottleShapeSpec): void {
    this.shape = spec
    for (const child of [...this.bottleSpin.children]) {
      this.bottleSpin.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }
    const body = new THREE.Mesh(latheFrom(spec.points.filter((p) => p.y <= spec.capStartY + 1e-6).concat([{ r: 0, y: spec.capStartY }])), this.bodyMat)
    body.castShadow = true
    const capPoints = [{ r: 0, y: spec.capStartY }, ...spec.points.filter((p) => p.y >= spec.capStartY - 1e-6)].map((p) => ({ r: p.r * 1.004, y: p.y }))
    const cap = new THREE.Mesh(latheFrom(capPoints), this.capMat)
    cap.castShadow = true
    const bandPoints = sliceProfile(spec.points, spec.label.y0, spec.label.y1).map((p) => ({ r: p.r * 1.012 + 0.002, y: p.y }))
    this.labelBand.geometry.dispose()
    this.labelBand.geometry = latheFrom(bandPoints)
    this.bottleSpin.add(body, cap, this.labelBand)
    this.activeRing.scale.setScalar(Math.max(0.6, spec.maxRadius / LAYOUT.bottle_radius))
  }

  /** Neutral wrap-around label with one marked "front" panel so rotation is visible. */
  private labelTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, 512, 96)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(176, 0, 160, 96)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '600 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('SIM MODEL', 256, 60)
      ctx.fillStyle = '#64748b'
      ctx.fillRect(176, 0, 160, 10)
      ctx.fillRect(176, 86, 160, 10)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    // Centre the front panel facing +Z (towards the default camera) at angle 0.
    texture.offset.x = 0.25
    texture.wrapS = THREE.RepeatWrapping
    return texture
  }

  private syncProduct(productId: string): void {
    if (productId === this.productKey) return
    this.productKey = productId
    const color = PRODUCT_COLORS[productId] ?? 0x64748b
    const texture = this.labelBand.material.map
    const canvas = texture?.image as HTMLCanvasElement | undefined
    const ctx = canvas?.getContext('2d')
    if (!ctx || !texture) return
    const css = hex(color, 1)
    ctx.fillStyle = css
    ctx.fillRect(176, 0, 160, 10)
    ctx.fillRect(176, 86, 160, 10)
    ctx.fillRect(0, 30, 176, 36)
    ctx.fillRect(336, 30, 176, 36)
    texture.needsUpdate = true
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
    // Low over the bottle and slightly forward, below the station signs behind the line.
    this.tag.position.set(pose.x, pose.y + this.shape.height + 0.35, pose.z + 0.25)
  }

  private makeSprite(text: string, color: string, background: string, width: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }))
    // Draw labels after the other transparent parts (floor grid, glass) so no line crosses the text.
    sprite.renderOrder = 10
    sprite.scale.set(width, width / 4, 1)
    this.drawSprite(sprite, text, color, background)
    return sprite
  }

  private drawSprite(sprite: THREE.Sprite, text: string, color: string, background: string): void {
    const texture = sprite.material.map as THREE.CanvasTexture
    const canvas = texture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = background
    roundRect(ctx, 6, 14, canvas.width - 12, canvas.height - 28, 22)
    ctx.fill()
    ctx.strokeStyle = 'rgba(18,213,245,0.55)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = color
    ctx.font = "700 54px system-ui, 'Noto Sans Thai', 'Leelawadee UI', sans-serif"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2, canvas.width - 40)
    texture.needsUpdate = true
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function hex(color: number, alpha: number): string {
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function latheFrom(points: Array<{ r: number; y: number }>): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(Math.max(0, p.r), p.y)), 40)
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
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const ok = !!gl
    ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
}
