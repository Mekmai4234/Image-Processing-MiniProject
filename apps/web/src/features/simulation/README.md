# features/simulation — งาน 02 (Three.js conveyor)

สถานะ: ต่อ DataSource ของ 01 ได้แล้ว (DEMO และ API จริง) แต่ยังไม่ได้ฝังในหน้า Simulation (รอ 01 อนุญาตแก้ SimulationPage)
อ้างอิง [API contract v0.2](../../../../../docs/api-contract.md) และ [architecture](../../../../../docs/architecture.md)

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `machine/` | state machine แบบ pure function (`transition`) + การคำนวณ evidence + ตำแหน่ง (`poseOf`) ไม่มี timer/fetch/Three.js |
| `controller/` | `SimulationController` รัน effect: เรียก API พร้อม AbortController และ timeout เวลาจริง, simulation clock, กันนับซ้ำ |
| `scene/` | `ConveyorScene` วาดจาก state อย่างเดียว + `FallbackDiagram` เมื่อไม่มี WebGL |
| `api/` | `InspectionPort`, `createDataSourcePort(ds)` ต่อ DataSource ของ 01, mock สำหรับ test, type จาก `src/types/inspection.ts` |
| `SimulationScene.tsx` | React component ให้ 01 ฝัง |

## วิธีฝังในหน้า Simulation (สำหรับ 01)

```tsx
import { SimulationScene, createDataSourcePort, machineConfigFrom, parseSimulationDefaults, toJobInput } from '../features/simulation'

const { ds, catalog } = useAppData()
const port = useMemo(() => createDataSourcePort(ds), [ds])          // สลับ DEMO/API จริงตาม ds
// defaults มาจาก GET /api/products → simulation_defaults (ไม่อ่าน .env จาก browser)
const config = useMemo(() => machineConfigFrom(parseSimulationDefaults(catalog) ?? undefined), [catalog])

<SimulationScene
  ref={sceneRef}                // start(job) / pause / resume / reset / retry / replay / setSpeed
  port={port}                   // port/config ใหม่ = ทิ้งงานเดิมแล้วสร้างฉากใหม่ (ต้อง useMemo)
  config={config}
  onSnapshot={setSnapshot}      // สถานะ/มุม/สถานี/ผล/error (ไม่ยิงทุกเฟรม)
  onCompleted={countAndRefresh} // ครั้งเดียวต่อ inspection_id เมื่อขวดถึงปลายทาง → ใช้นับสถิติ
/>
```

`sceneRef.current.start(toJobInput(product, views))` คืนรายการปัญหาของ input (ว่าง = เริ่มแล้ว) — `views` คือ `{ blob, name, angle }` แบบเดียวกับ `lib/views`
Three.js มีขนาดใหญ่ แนะนำให้ 01 โหลดหน้า Simulation ด้วย `React.lazy`

## ข้อตกลงที่โค้ดบังคับ

- ขวดออกจากกล้องได้ทางเดียวคือ `INSPECT_OK` ของ token ปัจจุบัน ไม่มี timer ที่ปล่อยขวด
- ผลที่มาหลัง reset ถูกทิ้งด้วย token; reset ไม่ลบ History และไม่อ้างว่ายกเลิกที่ server ได้
- Pause หยุดเวลาจำลอง ผลที่มาระหว่าง pause ถูกเก็บและใช้หลัง resume โดยไม่ยิงคำขอซ้ำ
- Retry ส่ง payload object เดิม (frozen) และ `client_request_id` เดิม; 400/409/413/422 ห้าม retry ต้อง reset
- ภาพเดียว: ข้ามการหมุนค้นหา `single_view/not_requested`
- หลายมุม: หมุนเฉพาะมุมจริงที่อัปโหลด ทีละมุม รอผล locate ก่อนมุมถัดไป
  - พบ usable → ส่งภาพนั้นภาพเดียว `single_view/usable_view_found` (ตัดสินใจ 19 ต.ค. 2026)
  - ค้นครบ/หมดเวลา → ส่งภาพตัวแทน + มุมที่ค้นแล้วเป็น `supporting_images` แล้วรอ Backend ตัดสิน
- ปลายทาง: PASS → ช่องรับสินค้า, FAIL → ถาด REJECT, REVIEW → ช่องรอถ่ายใหม่ (แยก, ตัดสินใจ 19 ต.ค. 2026)
- โมเดลขวดเป็นภาพแทน ไม่หุ้มภาพถ่าย; ภาพที่ส่งตรวจคือไฟล์จริงของผู้ใช้เท่านั้น
- `onCompleted` ส่งครั้งเดียวต่อ `inspection_id`; replay ส่ง `onReplayed` แทน
- unmount ยกเลิก rAF, abort คำขอ และ dispose geometry/material/texture/renderer

## ค่าตั้ง (ปรับได้ใน `machineConfigFrom` / `ControllerOptions`)

| ค่า | ค่าเริ่ม | ชนิดเวลา |
|---|---|---|
| timeout locate / inspect | 15 s / 30 s | เวลาจริง |
| งบค้นหามุมทั้งหมด | 60 s ไม่นับช่วง pause/error | เวลาจริง |
| ความเร็วจำลอง | 0.25x–3x | เวลาจำลอง |
| จำนวนภาพสูงสุด | 12 (`MAX_INSPECTION_VIEWS`) | — |

## การทดสอบ

รันใน `apps/web`: `npm test` และ `npm run build`

- unit: `__tests__/*.test.ts` 52 กรณี — transition ทุกสถานะ, pause/reset/retry/replay, evidence, controller + mock
  และ controller + `createDataSourcePort` กับ DEMO DataSource ของ 01 (PASS, หันหนีทุกมุม → REVIEW, 503 → retry, storage failed)
- e2e (harness นอก repo รอบ M1): PASS/FAIL/REVIEW, ERROR→retry, pause ระหว่างดัน, replay ไม่นับ, remount 15 รอบไม่มี loop ค้าง, WebGL fallback

## ข้อจำกัดที่รู้อยู่

- ยังไม่ได้ทดสอบกับ API จริงหรือภาพขวดจริงจาก 05
- ยังไม่ได้ฝังในหน้า Simulation จริง (รอ 01)
- frame rate วัดได้แค่บน software renderer ในเครื่องทดสอบ ต้องวัดซ้ำบน notebook ของทีม
