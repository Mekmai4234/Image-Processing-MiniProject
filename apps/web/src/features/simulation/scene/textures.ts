import * as THREE from 'three'

/**
 * Procedural textures drawn on canvases, so the scene needs no downloaded assets (no licence
 * or hosting questions). Every texture here is disposed by ConveyorScene.dispose().
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Deterministic pseudo-random so the scene looks the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Brushed-metal roughness: fine streaks along U. Linear data (not sRGB). */
export function brushedRoughness(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  if (g) {
    const r = rng(7)
    // Roughness multiplier ~0.75–0.95: streaky but not mirror-like.
    g.fillStyle = 'rgb(215,215,215)'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 1400; i++) {
      const y = r() * 256
      const v = 185 + Math.floor(r() * 60)
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`
      g.lineWidth = r() * 1.2 + 0.2
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(256, y + (r() - 0.5) * 2)
      g.stroke()
    }
  }
  return finish(c, 2, 2, false)
}

/** Aluminium extrusion face: two dark T-slot grooves along the length. */
export function extrusionMap(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64)
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, '#d9e0e8')
    grad.addColorStop(0.5, '#c4ccd6')
    grad.addColorStop(1, '#d4dbe3')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = '#5b6573'
    g.fillRect(0, 26, 64, 12)
    g.fillStyle = '#3c4552'
    g.fillRect(0, 29, 64, 6)
  }
  return finish(c, 8, 1)
}

/** Rubber belt with fine cross ribs; scroll offset.x to move it. */
export function beltMap(base: string, rib: string, lengthUnits: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 64)
  if (g) {
    g.fillStyle = base
    g.fillRect(0, 0, 128, 64)
    for (let x = 0; x < 128; x += 8) {
      g.fillStyle = rib
      g.fillRect(x, 0, 3, 64)
    }
    const r = rng(3)
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.04})`
      g.fillRect(r() * 128, r() * 64, 2, 1)
    }
  }
  return finish(c, Math.max(1, lengthUnits * 2), 1)
}

/** Roller surface stripes (so rotation is visible). */
export function rollerMap(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 16)
  if (g) {
    g.fillStyle = '#b9c3ce'
    g.fillRect(0, 0, 64, 16)
    g.fillStyle = '#7a8594'
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 5, 16)
  }
  return finish(c)
}

/** Dark painted panel with a vent grille block in the middle. */
export function ventPanel(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  if (g) {
    g.fillStyle = '#2a3340'
    g.fillRect(0, 0, 256, 256)
    g.strokeStyle = '#3d4856'
    g.lineWidth = 6
    g.strokeRect(10, 10, 236, 236)
    g.fillStyle = '#161c24'
    for (let y = 70; y < 190; y += 12) g.fillRect(70, y, 116, 6)
    g.fillStyle = '#f5b301'
    g.fillRect(190, 200, 40, 26)
    g.fillStyle = '#111'
    g.fillRect(196, 206, 28, 4)
  }
  return finish(c)
}

/** Safety stripe (yellow/black diagonal). */
export function hazardMap(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 32)
  if (g) {
    g.fillStyle = '#f5b301'
    g.fillRect(0, 0, 128, 32)
    g.fillStyle = '#111827'
    for (let x = -32; x < 160; x += 32) {
      g.beginPath()
      g.moveTo(x, 32)
      g.lineTo(x + 16, 32)
      g.lineTo(x + 32, 0)
      g.lineTo(x + 16, 0)
      g.closePath()
      g.fill()
    }
  }
  return finish(c, 4, 1)
}

/** Polished dark floor: faint tiles plus a soft vignette of wear. Roughness stays in the material. */
export function floorMap(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512)
  if (g) {
    g.fillStyle = '#0b1828'
    g.fillRect(0, 0, 512, 512)
    g.strokeStyle = 'rgba(80,140,200,0.07)'
    g.lineWidth = 2
    for (let i = 0; i <= 512; i += 128) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i, 512)
      g.moveTo(0, i)
      g.lineTo(512, i)
      g.stroke()
    }
    const r = rng(11)
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.02})`
      g.fillRect(r() * 512, r() * 512, 1.5, 1.5)
    }
  }
  return finish(c, 10, 6)
}

/**
 * Generic wave label (no brand). Covers the front half of the bottle so the turntable angle is
 * visible: at 0° the label faces the default camera; the back half stays clear plastic.
 * The accent colour follows the expected product.
 */
export function waveLabel(accent: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256)
  if (g) {
    g.clearRect(0, 0, 1024, 256)
    const x0 = 256
    const w = 512
    g.fillStyle = '#f8fbff'
    g.fillRect(x0, 0, w, 256)
    const waves = [
      { y: 150, amp: 26, color: accent, alpha: 1 },
      { y: 175, amp: 20, color: '#60a5fa', alpha: 0.8 },
      { y: 200, amp: 16, color: accent, alpha: 0.6 },
    ]
    for (const wv of waves) {
      g.globalAlpha = wv.alpha
      g.fillStyle = wv.color
      g.beginPath()
      g.moveTo(x0, 256)
      for (let x = 0; x <= w; x += 8) g.lineTo(x0 + x, wv.y + Math.sin((x / w) * Math.PI * 2.2) * wv.amp)
      g.lineTo(x0 + w, 256)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 1
    g.fillStyle = accent
    g.font = "800 64px system-ui, 'Noto Sans Thai', sans-serif"
    g.textAlign = 'center'
    g.fillText('SIM', x0 + w / 2, 92)
    g.fillStyle = '#64748b'
    g.font = '600 22px system-ui, sans-serif'
    g.fillText('SIMULATION MODEL', x0 + w / 2, 122)
  }
  const t = finish(c)
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** Ribbed cap: vertical ridges as a bump-like colour variation. */
export function capMap(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 32)
  if (g) {
    g.fillStyle = color
    g.fillRect(0, 0, 256, 32)
    g.fillStyle = 'rgba(0,0,0,0.22)'
    for (let x = 0; x < 256; x += 6) g.fillRect(x, 0, 2, 32)
  }
  return finish(c)
}
