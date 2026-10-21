import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { InspectionPort } from './api/port'
import type { ValidationIssue } from './machine/evidence'
import type { JobInput, MachineConfig } from './machine/types'
import {
  SimulationController,
  type CompletedEvent,
  type SimulationSnapshot,
} from './controller/SimulationController'
import { ConveyorScene, isWebGLAvailable } from './scene/ConveyorScene'
import { FallbackDiagram } from './scene/FallbackDiagram'
import { parseSilhouette, shapeFromSilhouette, type BottleShapeInput, type BottleShapeSpec } from './shape/bottleShape'
import {
  MODEL_NOTICE,
  SHAPE_FALLBACK_NOTICE,
  SHAPE_SILHOUETTE_NOTICE,
  REASON_LABEL,
  ROUTE_LABEL,
  SEARCH_STATUS_LABEL,
  SINGLE_VIEW_NOTICE,
  STATE_LABEL,
  VERDICT_LABEL,
} from './labels'
import './simulation.css'

export interface SimulationSceneHandle {
  start(job: JobInput): ValidationIssue[]
  pause(): void
  resume(): void
  reset(): void
  retry(): void
  replay(): void
  setSpeed(speed: number): void
  getSnapshot(): SimulationSnapshot | null
}

export interface SimulationSceneProps {
  /** createDataSourcePort(ds) — memoize it; a new port resets the scene and abandons the job. */
  port: InspectionPort
  /** From GET /api/products simulation_defaults — memoize it; a new config resets the scene. */
  config: MachineConfig
  onSnapshot?: (snapshot: SimulationSnapshot) => void
  /** Once per inspection_id when the bottle reaches its destination: the only place to count. */
  onCompleted?: (event: CompletedEvent) => void
  onReplayed?: (event: CompletedEvent) => void
  /** Show the built-in status / camera-monitor overlay. */
  showOverlay?: boolean
  /**
   * The POST /api/bottle-shape response for the main photo, passed as received (memoize it).
   * null, status "fallback" or anything that fails validation → generic shape.
   * Visual only — it never affects the inspection.
   */
  bottleShape?: BottleShapeInput | null
  className?: string
  /** Force the 2D fallback (testing). */
  forceFallback?: boolean
}

/**
 * Embeddable 3D line. Owns one controller + one renderer + one animation loop, all released on
 * unmount (leaving the page abandons the job without deleting any History).
 */
export const SimulationScene = forwardRef<SimulationSceneHandle, SimulationSceneProps>(function SimulationScene(
  { port, config, onSnapshot, onCompleted, onReplayed, showOverlay = true, className, forceFallback = false, bottleShape = null },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<SimulationController | null>(null)
  const callbacks = useRef({ onSnapshot, onCompleted, onReplayed })
  callbacks.current = { onSnapshot, onCompleted, onReplayed }
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null)
  const [webgl, setWebgl] = useState<boolean | null>(null)
  const sceneRef = useRef<ConveyorScene | null>(null)
  const shape = useMemo(() => shapeFromSilhouette(parseSilhouette(bottleShape)), [bottleShape])
  const shapeRef = useRef<BottleShapeSpec>(shape)
  shapeRef.current = shape
  useEffect(() => {
    sceneRef.current?.setBottleShape(shape)
  }, [shape])

  useImperativeHandle(
    ref,
    () => ({
      start: (job) => controllerRef.current?.start(job) ?? [],
      pause: () => controllerRef.current?.pause(),
      resume: () => controllerRef.current?.resume(),
      reset: () => controllerRef.current?.reset(),
      retry: () => controllerRef.current?.retry(),
      replay: () => controllerRef.current?.replay(),
      setSpeed: (speed) => controllerRef.current?.setSpeed(speed),
      getSnapshot: () => controllerRef.current?.getSnapshot() ?? null,
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const controller = new SimulationController({ port, config })
    controllerRef.current = controller
    const offSnapshot = controller.onSnapshot((s) => {
      setSnapshot(s)
      callbacks.current.onSnapshot?.(s)
    })
    const offCompleted = controller.onCompleted((e) => callbacks.current.onCompleted?.(e))
    const offReplayed = controller.onReplayed((e) => callbacks.current.onReplayed?.(e))
    setSnapshot(controller.getSnapshot())

    const canUseWebGL = !forceFallback && isWebGLAvailable()
    setWebgl(canUseWebGL)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let scene: ConveyorScene | null = null
    if (canUseWebGL) {
      try {
        scene = new ConveyorScene(host, { reducedMotion })
        scene.setBottleShape(shapeRef.current)
        sceneRef.current = scene
      } catch {
        scene = null
        setWebgl(false)
      }
    }

    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      controller.tick(dt)
      scene?.render(controller.getState(), dt)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      offSnapshot()
      offCompleted()
      offReplayed()
      controller.destroy()
      scene?.dispose()
      sceneRef.current = null
      controllerRef.current = null
    }
    // A new port (DEMO ↔ live) or config abandons the current job and builds a fresh
    // controller + scene; the cleanup above aborts requests and disposes the renderer.
    // Pass memoized values so this only happens when the source/config really changes.
  }, [port, config, forceFallback])

  return (
    <div className={`vv-sim ${className ?? ''}`}>
      <div ref={hostRef} className="vv-sim__canvas" />
      {webgl === false && snapshot && <FallbackDiagram snapshot={snapshot} />}
      {showOverlay && snapshot && <Overlay snapshot={snapshot} controller={controllerRef.current} shape={shape} />}
    </div>
  )
})

function Overlay({ snapshot, controller, shape }: { snapshot: SimulationSnapshot; controller: SimulationController | null; shape: BottleShapeSpec }) {
  const job = controller?.getState().job ?? null
  const urls = useViewUrls(snapshot.job_id, job?.views.map((v) => v.image) ?? [])
  const viewIndex =
    snapshot.phase === 'ORIENT' ? snapshot.orient?.current_view_index ?? null : snapshot.primary_view_index ?? (snapshot.mode === 'single_view' ? 0 : null)
  const monitorUrl = viewIndex !== null ? urls[viewIndex] : undefined
  const monitorAngle = viewIndex !== null ? job?.views[viewIndex]?.angle_deg ?? null : null
  const result = snapshot.result
  const verdictClass = result ? `vv-sim__result--${result.result.toLowerCase()}` : ''

  return (
    <div className="vv-sim__overlay">
      <div className="vv-sim__topbar">
        <span className={`vv-sim__state vv-sim__state--${snapshot.state.toLowerCase()}`} role="status" aria-live="polite">
          {STATE_LABEL[snapshot.state]}
          {snapshot.replaying ? ' · เล่นซ้ำ (ไม่บันทึกใหม่)' : ''}
        </span>
        {snapshot.demo && <span className="vv-sim__demo">DEMO · ข้อมูลจำลอง</span>}
        {snapshot.speed !== 1 && <span className="vv-sim__chip">{snapshot.speed}x</span>}
      </div>

      {snapshot.mode === 'single_view' && <p className="vv-sim__notice">{SINGLE_VIEW_NOTICE}</p>}

      {snapshot.orient && (
        <div className="vv-sim__orient">
          <span>
            มุมที่ค้นแล้ว {snapshot.orient.tried_angles.length}/{snapshot.orient.total}
            {snapshot.orient.search_status ? ` · ${SEARCH_STATUS_LABEL[snapshot.orient.search_status]}` : ''}
          </span>
          <span className="vv-sim__angles">
            {snapshot.orient.tried_angles.map((a, i) => (
              <span key={i}>{a === null ? '?' : `${a}°`}</span>
            ))}
          </span>
        </div>
      )}

      {snapshot.state === 'ERROR' && snapshot.error && (
        <div className="vv-sim__error" role="alert">
          <strong>ระบบขัดข้อง — ยังไม่มีผลตรวจสินค้า</strong>
          <span>
            {snapshot.error.message}
            {snapshot.error.status ? ` (HTTP ${snapshot.error.status})` : ''}
          </span>
          <span>{snapshot.error.retryable ? 'กด "ลองใหม่" เพื่อส่งคำขอเดิมซ้ำ' : 'ต้องรีเซ็ตและตรวจข้อมูลก่อนเริ่มใหม่'}</span>
        </div>
      )}

      {result && (snapshot.phase === 'SORT' || snapshot.phase === 'OUTPUT' || snapshot.phase === 'COMPLETE') && (
        <div className={`vv-sim__result ${verdictClass}`}>
          <strong>{VERDICT_LABEL[result.result]}</strong>
          <span>{REASON_LABEL[result.reason]}</span>
          {snapshot.route && <span>→ {ROUTE_LABEL[snapshot.route]}</span>}
          {result.storage_status === 'failed' && <span className="vv-sim__warn">บันทึกไฟล์ไม่สำเร็จ (ผลตรวจไม่เปลี่ยน)</span>}
        </div>
      )}

      {job && (
        <figure className="vv-sim__monitor">
          {monitorUrl ? <img src={monitorUrl} alt={`ภาพจริงมุม ${monitorAngle ?? 'ไม่ทราบ'}`} /> : <div className="vv-sim__monitor-empty">รอขวดถึงกล้อง</div>}
          <figcaption>
            {snapshot.phase === 'ORIENT'
              ? `ส่งหาฉลาก · มุม ${monitorAngle ?? '?'}°`
              : `ภาพจริงที่ใช้ส่งตรวจ${monitorAngle !== null ? ` · ${monitorAngle}°` : ''}`}
          </figcaption>
        </figure>
      )}

      <p className="vv-sim__footnote">
        {shape.source === 'silhouette' ? SHAPE_SILHOUETTE_NOTICE : `${SHAPE_FALLBACK_NOTICE} (${shape.reason})`} · {MODEL_NOTICE}
      </p>
    </div>
  )
}

/** Object URLs for the current job's photos, revoked when the job changes or on unmount. */
function useViewUrls(jobId: string | null, images: Blob[]): string[] {
  const [urls, setUrls] = useState<string[]>([])
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => {
    const created = imagesRef.current.map((b) => URL.createObjectURL(b))
    setUrls(created)
    return () => created.forEach((u) => URL.revokeObjectURL(u))
  }, [jobId])
  return urls
}
