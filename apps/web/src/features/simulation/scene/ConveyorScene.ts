import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { InspectionVerdict } from '../api/contract'
import { LAYOUT, poseOf } from '../machine/motion'
import type { MachineState } from '../machine/types'

export interface ConveyorSceneOptions {
  reducedMotion?: boolean
}

const COLORS = {
  background: 0x0a1626,
  floor: 0x0e1f33,
  frame: 0x9aa8b8,
  frameDark: 0x4a5869,
  belt: 0x1d2733,
  pass: 0x22c55e,
  reject: 0xef4444,
  review: 0xf5b301,
  accent: 0x38bdf8,
}

const PRODUCT_COLORS: Record<string, number> = { bottle_a: 0x2563eb, bottle_b: 0x16a34a }
const VERDICT_COLORS: Record<InspectionVerdict, string> = { PASS: '#22c55e', FAIL: '#ef4444', REVIEW: '#f5b301' }

const BELT_HALF_WIDTH = 0.55
const LINE_SPAN = LAYOUT.pass_end_x + 1.2 - (LAYOUT.dispenser_x - 1.2)
const VIEW_TARGET = new THREE.Vector3((LAYOUT.pass_end_x + LAYOUT.dispenser_x) / 2, 0.5, 0.45)
const VIEW_DIRECTION = new THREE.Vector3(0, 0.62, 0.78).normalize()
const BOTTLE_HEIGHT = 1.05

let liveInstances = 0

/**
 * Renders the virtual line from MachineState. It owns no timers and no logic: positions come
 * from poseOf(state). Call render() from the host's animation frame and dispose() on unmount.
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

  private readonly bottle = new THREE.Group()
  /** Inner group spun by the turntable angle; the outer group carries position and tilt. */
  private readonly bottleSpin = new THREE.Group()
  private readonly labelBand: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>
  private readonly turntableTop = new THREE.Group()
  private readonly rejectPlate = new THREE.Group()
  private readonly reviewPlate = new THREE.Group()
  private readonly ringLight: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  private readonly flashLight: THREE.SpotLight
  private readonly beltTextures: THREE.Texture[] = []
  private readonly tag: THREE.Sprite
  private tagKey = ''
  private productKey = ''
  private disposed = false

  constructor(private readonly container: HTMLElement, options: ConveyorSceneOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(COLORS.background)
    this.scene.fog = new THREE.Fog(COLORS.background, 22, 40)

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(VIEW_TARGET)
    this.controls.enableDamping = !this.reducedMotion
    this.controls.minDistance = 5
    this.controls.maxDistance = 30
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.enablePan = false
    this.controls.update()

    this.buildLights()
    this.buildFloor()
    this.buildConveyor()
    this.buildDispenser()
    this.buildTurntableStation()
    this.flashLight = this.scene.getObjectByName('flash-light') as THREE.SpotLight
    this.ringLight = this.scene.getObjectByName('ring-light') as THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
    this.buildPusher(LAYOUT.reject_x, COLORS.reject, this.rejectPlate)
    this.buildPusher(LAYOUT.review_x, COLORS.review, this.reviewPlate)
    this.buildTray(LAYOUT.reject_x, COLORS.reject, 'REJECT · FAIL')
    this.buildTray(LAYOUT.review_x, COLORS.review, 'REVIEW · ถ่ายใหม่')
    this.buildPassOutput()
    this.buildStationLabels()
    this.labelBand = this.buildBottle()
    this.tag = this.makeSprite(' ', '#ffffff', 'rgba(10,22,38,0.85)', 1.6)
    this.tag.visible = false
    this.scene.add(this.tag)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    liveInstances += 1
  }

  render(state: Readonly<MachineState>, realDtSeconds: number): void {
    if (this.disposed) return
    const pose = poseOf(state as MachineState)

    this.syncProduct(state.job?.expected_product ?? '')
    this.bottle.visible = pose.visible
    this.bottle.position.set(pose.x, pose.y, pose.z)
    this.bottleSpin.rotation.y = THREE.MathUtils.degToRad(-pose.angle_deg)
    this.bottle.rotation.x = pose.tilt

    const onTurntable = ['ORIENT', 'SETTLE', 'INSPECT', 'WAIT_RESULT', 'ERROR'].includes(state.phase)
    if (onTurntable) this.turntableTop.rotation.y = this.bottleSpin.rotation.y

    this.rejectPlate.position.z = THREE.MathUtils.lerp(LAYOUT.pusher_rest_z, LAYOUT.pusher_reach_z, pose.reject_pusher)
    this.reviewPlate.position.z = THREE.MathUtils.lerp(LAYOUT.pusher_rest_z, LAYOUT.pusher_reach_z, pose.review_pusher)

    const flash = this.reducedMotion ? Math.min(pose.flash, 0.5) : pose.flash
    this.flashLight.intensity = 2 + flash * 60
    this.ringLight.material.emissiveIntensity = 0.4 + flash * 4

    if (pose.belt_moving && !this.reducedMotion && !state.paused) {
      for (const texture of this.beltTextures) texture.offset.x -= realDtSeconds * 0.9
    }

    this.updateTag(state, pose.x, pose.y, pose.z)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  /** Releases every GPU resource and listener. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    this.controls.dispose()
    const textures = new Set<THREE.Texture>()
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
        material.dispose()
      }
    })
    for (const texture of textures) texture.dispose()
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    liveInstances -= 1
  }

  // ---- building -------------------------------------------------------------------------

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    this.camera.aspect = aspect
    this.camera.fov = aspect < 1.2 ? 50 : 34
    this.camera.updateProjectionMatrix()
    // Fit the whole line (dispenser → PASS bin) horizontally for this aspect ratio.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const fitH = LINE_SPAN / 2 / Math.tan(hfov / 2)
    const fitV = 4.2 / Math.tan(vfov / 2)
    const distance = Math.min(this.controls.maxDistance, Math.max(fitH, fitV) * 1.04)
    this.camera.position.copy(VIEW_TARGET).addScaledVector(VIEW_DIRECTION, distance)
    this.controls.update()
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x0b1320, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(-4, 10, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 512)
    sun.shadow.camera.left = -10
    sun.shadow.camera.right = 10
    sun.shadow.camera.top = 6
    sun.shadow.camera.bottom = -6
    sun.shadow.bias = -0.0005
    this.scene.add(sun)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.6)
    rim.position.set(6, 4, -6)
    this.scene.add(rim)
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 24),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)
    const grid = new THREE.GridHelper(40, 40, 0x1e3a5f, 0x15283f)
    grid.position.y = 0.002
    this.scene.add(grid)
  }

  private metal(color = COLORS.frame): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.35 })
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  private beltTexture(color: string, stripe: string, repeat: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 128, 32)
      ctx.fillStyle = stripe
      for (let x = 0; x < 128; x += 16) ctx.fillRect(x, 0, 3, 32)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat, 1)
    texture.colorSpace = THREE.SRGBColorSpace
    this.beltTextures.push(texture)
    return texture
  }

  private buildConveyor(): void {
    const start = LAYOUT.dispenser_x - 0.6
    const end = LAYOUT.pass_gate_x + 0.3
    const length = end - start
    const center = (start + end) / 2
    const beltTop = LAYOUT.belt_y
    const belt = this.box(
      length,
      0.08,
      BELT_HALF_WIDTH * 2,
      new THREE.MeshStandardMaterial({ map: this.beltTexture('#1f2a37', '#2f3d4f', length), roughness: 0.8 }),
      center,
      beltTop - 0.04,
      0,
    )
    belt.castShadow = false
    const rail = this.metal()
    for (const z of [-BELT_HALF_WIDTH - 0.06, BELT_HALF_WIDTH + 0.06]) {
      this.box(length, 0.16, 0.08, rail, center, beltTop - 0.02, z)
    }
    const leg = this.metal(COLORS.frameDark)
    for (let x = start + 0.4; x <= end - 0.2; x += 2.2) {
      for (const z of [-BELT_HALF_WIDTH, BELT_HALF_WIDTH]) this.box(0.1, beltTop - 0.1, 0.1, leg, x, (beltTop - 0.1) / 2, z)
    }
    // Direction arrows on the belt surface.
    const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.55 })
    const arrowShape = new THREE.Shape()
    arrowShape.moveTo(0.18, 0)
    arrowShape.lineTo(-0.12, 0.14)
    arrowShape.lineTo(-0.12, -0.14)
    arrowShape.closePath()
    const arrowGeo = new THREE.ShapeGeometry(arrowShape)
    for (const x of [LAYOUT.dispenser_x + 1.4, LAYOUT.turntable_x - 1.4, LAYOUT.turntable_x + 1.6, LAYOUT.review_x + 0.9]) {
      const arrow = new THREE.Mesh(arrowGeo, arrowMat)
      arrow.rotation.x = -Math.PI / 2
      arrow.position.set(x, beltTop + 0.003, BELT_HALF_WIDTH - 0.15)
      this.scene.add(arrow)
    }
  }

  private buildDispenser(): void {
    const x = LAYOUT.dispenser_x - 0.4
    const body = this.metal(0x334155)
    this.box(1.3, 2.4, 1.6, body, x, 1.2, 0)
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b2540, emissive: 0x0b3a63, emissiveIntensity: 0.6, roughness: 0.2 })
    this.box(0.02, 1.2, 1.1, glass, x + 0.66, 1.55, 0)
    this.box(0.04, 0.5, 0.9, new THREE.MeshStandardMaterial({ color: 0x020617 }), x + 0.66, 0.78, 0)
  }

  private buildTurntableStation(): void {
    const x = LAYOUT.turntable_x
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.1, 48), this.metal(COLORS.frameDark))
    base.position.set(x, LAYOUT.belt_y + 0.02, 0)
    base.receiveShadow = true
    this.scene.add(base)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 48), this.metal(0xcbd5e1))
    top.receiveShadow = true
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.012, 0.38),
      new THREE.MeshBasicMaterial({ color: COLORS.accent }),
    )
    marker.position.set(0, 0.026, 0.3)
    this.turntableTop.add(top, marker)
    this.turntableTop.position.set(x, LAYOUT.turntable_top_y - 0.02, 0)
    this.scene.add(this.turntableTop)

    // Gantry with the inspection camera directly above the turntable.
    const frame = this.metal()
    const h = 2.7
    for (const dx of [-0.95, 0.95]) for (const dz of [-0.85, 0.85]) this.box(0.09, h, 0.09, frame, x + dx, h / 2, dz)
    for (const dz of [-0.85, 0.85]) this.box(1.99, 0.09, 0.09, frame, x, h, dz)
    for (const dx of [-0.95, 0.95]) this.box(0.09, 0.09, 1.79, frame, x + dx, h, 0)
    this.box(0.12, 0.09, 1.7, frame, x, h, 0)
    const camBody = this.box(0.42, 0.3, 0.32, new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.4, roughness: 0.4 }), x, h - 0.22, 0)
    camBody.castShadow = false
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 24), new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.2 }))
    lens.position.set(x, h - 0.45, 0)
    this.scene.add(lens)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.03, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x7dd3fc, emissiveIntensity: 0.4 }),
    )
    ring.name = 'ring-light'
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, h - 0.52, 0)
    this.scene.add(ring)
    const spot = new THREE.SpotLight(0xe0f2fe, 2, 5, Math.PI / 7, 0.5, 1.2)
    spot.name = 'flash-light'
    spot.position.set(x, h - 0.5, 0)
    spot.target.position.set(x, LAYOUT.turntable_top_y, 0)
    this.scene.add(spot, spot.target)
  }

  private buildPusher(x: number, color: number, plate: THREE.Group): void {
    const housing = this.metal(0x475569)
    this.box(0.5, 0.36, 0.5, housing, x, LAYOUT.belt_y + 0.2, LAYOUT.pusher_rest_z - 0.55)
    const stripe = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
    this.box(0.52, 0.06, 0.52, stripe, x, LAYOUT.belt_y + 0.4, LAYOUT.pusher_rest_z - 0.55)
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.06), new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 }))
    face.castShadow = true
    face.position.z = -0.03
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 12), this.metal(0xe2e8f0))
    rod.rotation.x = Math.PI / 2
    rod.position.z = -0.73
    plate.add(face, rod)
    plate.position.set(x, LAYOUT.belt_y + 0.24, LAYOUT.pusher_rest_z)
    this.scene.add(plate)
  }

  private buildTray(x: number, color: number, text: string): void {
    const z = LAYOUT.tray_z
    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.55 })
    const y = LAYOUT.belt_y - 0.42
    this.box(1.3, 0.06, 1.1, material, x, y, z)
    this.box(1.3, 0.34, 0.06, material, x, y + 0.17, z + 0.55)
    this.box(0.06, 0.34, 1.1, material, x - 0.65, y + 0.17, z)
    this.box(0.06, 0.34, 1.1, material, x + 0.65, y + 0.17, z)
    // Short ramp from the belt edge down into the tray.
    const ramp = this.box(0.8, 0.03, 0.7, new THREE.MeshStandardMaterial({ color: 0xb6c2d1, metalness: 0.7, roughness: 0.3 }), x, LAYOUT.belt_y - 0.17, BELT_HALF_WIDTH + 0.32)
    ramp.rotation.x = 0.45
    const legMat = this.metal(COLORS.frameDark)
    for (const dx of [-0.55, 0.55]) this.box(0.06, y, 0.06, legMat, x + dx, y / 2, z + 0.45)
    const label = this.makeSprite(text, '#ffffff', hex(color, 0.92), 2.1)
    label.position.set(x, 0.32, z + 0.95)
    this.scene.add(label)
  }

  private buildPassOutput(): void {
    const start = LAYOUT.pass_gate_x + 0.3
    const end = LAYOUT.pass_end_x + 0.7
    const length = end - start
    const belt = this.box(
      length,
      0.08,
      BELT_HALF_WIDTH * 2,
      new THREE.MeshStandardMaterial({ map: this.beltTexture('#14532d', '#1f7a43', length), roughness: 0.7 }),
      (start + end) / 2,
      LAYOUT.belt_y - 0.04,
      0,
    )
    belt.castShadow = false
    const rail = this.metal()
    for (const z of [-BELT_HALF_WIDTH - 0.06, BELT_HALF_WIDTH + 0.06]) this.box(length, 0.16, 0.08, rail, (start + end) / 2, LAYOUT.belt_y - 0.02, z)
    const bin = new THREE.MeshStandardMaterial({ color: COLORS.pass, metalness: 0.2, roughness: 0.5 })
    this.box(0.06, 0.5, 1.3, bin, end + 0.03, LAYOUT.belt_y - 0.1, 0)
    const leg = this.metal(COLORS.frameDark)
    for (const z of [-BELT_HALF_WIDTH, BELT_HALF_WIDTH]) this.box(0.1, LAYOUT.belt_y - 0.1, 0.1, leg, end - 0.3, (LAYOUT.belt_y - 0.1) / 2, z)
    const label = this.makeSprite('PASS · รับสินค้า', '#ffffff', hex(COLORS.pass, 0.92), 2.1)
    label.position.set(LAYOUT.pass_end_x - 0.2, LAYOUT.belt_y + 0.95, -1.05)
    this.scene.add(label)
  }

  private buildStationLabels(): void {
    const feed = this.makeSprite('FEED', '#e0f2fe', 'rgba(14,52,96,0.92)', 1.4)
    feed.position.set(LAYOUT.dispenser_x - 0.4, 2.95, 0)
    const orient = this.makeSprite('ORIENT · INSPECT', '#e0f2fe', 'rgba(14,52,96,0.92)', 2.3)
    orient.position.set(LAYOUT.turntable_x, 3.25, 0)
    this.scene.add(feed, orient)
  }

  private buildBottle(): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> {
    // Generic lathe bottle: a representation, not a reconstruction of the photographed bottle.
    const r = LAYOUT.bottle_radius
    const profile = [
      [0, 0], [r * 0.82, 0], [r, 0.04], [r, 0.62], [r * 0.96, 0.7], [r * 0.55, 0.86],
      [r * 0.4, 0.93], [r * 0.4, 0.97], [0, 0.97],
    ].map(([px, py]) => new THREE.Vector2(px ?? 0, (py ?? 0) * BOTTLE_HEIGHT))
    const body = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 40),
      new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
    )
    body.castShadow = true
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4 }))
    cap.position.y = BOTTLE_HEIGHT * 0.97 + 0.06
    cap.castShadow = true
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.3, 40, 1, true),
      new THREE.MeshStandardMaterial({ map: this.labelTexture(), roughness: 0.6, side: THREE.DoubleSide }),
    )
    band.position.y = BOTTLE_HEIGHT * 0.36
    this.bottleSpin.add(body, cap, band)
    this.bottle.add(this.bottleSpin)
    this.bottle.visible = false
    this.scene.add(this.bottle)
    return band
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

  private updateTag(state: Readonly<MachineState>, x: number, y: number, z: number): void {
    const verdict = state.result?.result
    const show = !!verdict && ['SORT', 'OUTPUT', 'COMPLETE'].includes(state.phase)
    this.tag.visible = show && this.bottle.visible
    if (!show || !verdict) return
    const key = `${verdict}:${state.result?.reason}`
    if (key !== this.tagKey) {
      this.tagKey = key
      this.drawSprite(this.tag, verdict === 'REVIEW' ? 'REVIEW' : verdict, '#0a1626', VERDICT_COLORS[verdict])
    }
    this.tag.position.set(x, y + BOTTLE_HEIGHT + 0.5, z)
  }

  private makeSprite(text: string, color: string, background: string, width: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }))
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
    roundRect(ctx, 6, 14, canvas.width - 12, canvas.height - 28, 26)
    ctx.fill()
    ctx.fillStyle = color
    ctx.font = "700 52px system-ui, 'Noto Sans Thai', 'Leelawadee UI', sans-serif"
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
