// กันไม่ให้ CSS ของ feature (02 simulation, 04 webcam) เปลี่ยนหน้าตา component กลางของ 01
// กติกา: feature CSS ใช้ได้เฉพาะ class ของตัวเอง ห้าม :root, ทุก selector ต้องมี class ของ feature,
// และทุกส่วนของ selector ต้องผูกกับ class ของ feature ไม่ใช่ class กลางใน styles/global.css อย่างเดียว
// ไฟล์นี้รันใน Node และ type-check ด้วย tsconfig.node.json (ไม่ใช่ tsconfig.app.json ของ browser)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../', import.meta.url))

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return cssFiles(p)
    return p.endsWith('.css') ? [p] : []
  })
}

/** รายการ selector (ส่วนก่อน {) โดยตัด comment และเนื้อใน @media ออกแค่ส่วนหัว */
function selectors(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim()
    if (!head || head.startsWith('@')) continue
    // keyframe steps (0%, from, to) ไม่ใช่ selector
    if (/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(head)) continue
    out.push(...head.split(',').map((s) => s.trim()).filter(Boolean))
  }
  return out
}

function classesIn(selector: string): string[] {
  return [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1])
}

const sharedClasses = new Set(selectors(readFileSync(join(SRC, 'styles/global.css'), 'utf8')).flatMap(classesIn))
const featureFiles = cssFiles(join(SRC, 'features')).map((f) => relative(SRC, f).replaceAll('\\', '/'))

describe('feature CSS ไม่กระทบ component กลาง', () => {
  it('อ่าน class กลางจาก global.css ได้', () => {
    expect(sharedClasses.has('panel')).toBe(true)
    expect(sharedClasses.has('btn')).toBe(true)
  })

  it('พบไฟล์ CSS ของ feature', () => {
    expect(featureFiles.length).toBeGreaterThan(0)
  })

  it.each(featureFiles.map((f) => [f]))('%s', (file) => {
    const list = selectors(readFileSync(join(SRC, file), 'utf8'))
    const problems: string[] = []
    for (const sel of list) {
      if (sel.includes(':root')) problems.push(`${sel}: ห้ามประกาศ :root (ใช้ token ใน global.css)`)
      // selector ต้องผูกกับ class ของ feature อย่างน้อยหนึ่งตัว: body / button / input:checked เปล่า ๆ ไม่ได้
      // แต่ input:checked + .toggle-slider ได้ เพราะเป้าหมายคือ .toggle-slider ของ feature เอง
      if (!classesIn(sel).some((c) => !sharedClasses.has(c))) problems.push(`${sel}: ต้องมี class ของ feature อย่างน้อยหนึ่งตัว`)
      // แต่ละส่วนของ selector (คั่นด้วย space > + ~) ต้องมี class ของ feature อย่างน้อยหนึ่งตัว
      // .btn-tool.active ใช้ได้ (ผูกกับ .btn-tool) แต่ .camera-card .panel ไม่ได้ (ไปแต่ง .panel กลาง)
      for (const part of sel.split(/\s*[\s>+~]\s*/).filter(Boolean)) {
        const cls = classesIn(part)
        if (cls.length > 0 && cls.every((c) => sharedClasses.has(c))) {
          problems.push(`${sel}: "${part}" เป็น class ของ component กลาง (global.css)`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
