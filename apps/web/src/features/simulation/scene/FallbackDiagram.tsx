import type { SimulationSnapshot, Station } from '../controller/SimulationController'

const STATIONS: Array<{ id: Station; label: string }> = [
  { id: 'conveyor', label: 'สายพาน' },
  { id: 'camera_turntable', label: 'แท่นหมุน + กล้อง' },
  { id: 'reject_tray', label: 'REJECT' },
  { id: 'review_lane', label: 'REVIEW' },
  { id: 'pass_output', label: 'PASS' },
]

/** 2D stand-in when WebGL is unavailable. Driven by the same controller, so behaviour is identical. */
export function FallbackDiagram({ snapshot }: { snapshot: SimulationSnapshot }) {
  return (
    <div className="vv-sim__fallback" role="img" aria-label={`ตำแหน่งขวด: ${snapshot.current_station ?? 'ยังไม่มีขวด'}`}>
      <p>เบราว์เซอร์นี้ใช้ WebGL ไม่ได้ จึงแสดงแผนผัง 2D แทน (ลำดับและผลตรวจเหมือนกัน)</p>
      <ol>
        {STATIONS.map((station) => (
          <li key={station.id} className={snapshot.current_station === station.id ? 'is-active' : ''}>
            {station.label}
            {snapshot.current_station === station.id && <span className="vv-sim__dot" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </div>
  )
}
