# features/simulation — งาน 02 (Three.js conveyor)

สถานะ: component + ตัวต่อ DataSource พร้อมให้ 01 ประกอบเข้าหน้า Simulation (ตกลงกับ 01: 02 แก้เฉพาะ `features/simulation/`, 01 แก้ `SimulationPage.tsx` และ `slots.ts`)
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

### 1. สร้าง port และ config

```tsx
import { useMemo, useRef, useState } from 'react'
import {
  SimulationScene, createDataSourcePort, machineConfigFrom, parseSimulationDefaults, toJobInput,
  type SimulationSceneHandle, type SimulationSnapshot, type CompletedEvent,
} from '../features/simulation'

const { ds, catalog } = useAppData()
// ds ของ 01 (live หรือ demo) → port; ds เปลี่ยน = ฉากทิ้งงานเดิมแล้วสร้างใหม่ (ต้อง useMemo)
const port = useMemo(() => createDataSourcePort(ds), [ds])
// simulation_defaults จาก GET /api/products (ไม่อ่าน .env จาก browser); ไม่มีค่า → ค่าเริ่ม 360/30
const config = useMemo(() => machineConfigFrom(parseSimulationDefaults(catalog) ?? undefined), [catalog])
```

### 2. วาง component และรับ event

```tsx
const sceneRef = useRef<SimulationSceneHandle>(null)
const [snap, setSnap] = useState<SimulationSnapshot | null>(null)

<SimulationScene
  ref={sceneRef}
  port={port}
  config={config}
  onSnapshot={setSnap}              // ยิงเมื่อมีการเปลี่ยนที่มีความหมาย ไม่ใช่ทุกเฟรม
  onCompleted={(e: CompletedEvent) => addToSessionStats(e.result)}  // ครั้งเดียวต่อ inspection_id
  onReplayed={() => {}}             // เล่นซ้ำ: ห้ามนับ
  showOverlay={false}               // ถ้า 01 ทำ panel เอง ปิด overlay ในฉากได้ (ป้าย DEMO/ข้อจำกัดต้องแสดงที่ panel ของ 01 แทน)
  bottleShape={null}                // รอ API ของ 04; null = รูปทรงสำรอง
  quality="auto"
/>
```

### 3. ปุ่มควบคุม → handle

| ปุ่มในหน้า | เรียก | หมายเหตุ |
|---|---|---|
| ตรวจชุดภาพนี้ (Run) | `sceneRef.current?.start(toJobInput(product, views))` | คืน `ValidationIssue[]`; ว่าง = เริ่มแล้ว; ไม่ว่าง = แสดง `issue.message` (เช่น หลายภาพแต่มีภาพไม่ระบุมุม) |
| Pause / ทำต่อ | `pause()` / `resume()` | ใช้ได้เมื่อ `snap.state` ไม่ใช่ IDLE/COMPLETE/ERROR/PAUSED |
| รีเซ็ต | `reset()` | ทิ้งงาน ไม่ลบ History — แสดง `RESET_NOTICE` ถ้ากดระหว่างทำงาน |
| ลองใหม่ | `retry()` | เปิดเมื่อ `snap.state === 'ERROR' && snap.error?.retryable` |
| เล่นซ้ำ | `replay()` | เปิดเมื่อ `snap.state === 'COMPLETE'`; ไม่ยิง API ไม่นับสถิติ |
| Speed | `setSpeed(x)` | 0.25–3; ไม่กระทบ timeout ของ network |

`views` คือ `{ blob, name, angle }` แบบเดียวกับ `ViewItem` ใน `lib/views` — **ไม่ต้องใช้** `buildSimulationRequest`/`useInspectionRun` แล้ว เพราะ controller ของฉากสร้างคำขอและ evidence เอง (ส่งคำขอเดียว ไม่ซ้ำ)

### 4. field ใน `SimulationSnapshot`

| field | ใช้ทำอะไรในหน้า |
|---|---|
| `state` | IDLE / FEED / ORIENT / SETTLE / INSPECT / WAIT_RESULT / SORT / OUTPUT / COMPLETE / PAUSED / ERROR → pipeline + ปุ่ม (`STATE_LABEL` มีข้อความไทย) |
| `phase`, `paused` | phase จริงแม้กำลัง pause |
| `demo` | true เมื่อ ds เป็น DEMO → แสดง DemoTag |
| `job_id`, `inspection_id` | id ของงานในฉาก / id จาก backend (ผูก History) |
| `mode` | `single_view` → แสดง `SINGLE_VIEW_NOTICE` |
| `current_station` | conveyor / orient_turntable / inspect_camera / reject_tray / review_lane / pass_output |
| `orient` | `tried_angles`, `total`, `current_view_index`, `search_status` → กล่อง "Orientation status" (`SEARCH_STATUS_LABEL`) |
| `current_angle_deg` | มุมของภาพที่กำลังค้น/ที่เลือก |
| `current_image` | Blob ของภาพจริงที่ locator กำลังดูใน ORIENT |
| `captured_image`, `captured_angle_deg` | **Blob ของภาพจริงที่ส่งตรวจ** + มุม → "Captured inspection image" |
| `result` | `InspectionResult` เต็ม (result, reason, match_score, bbox, expected_bbox, image_width/height, storage_status, images, evidence) |
| `route` | pass / reject / review |
| `error` | `{ message, status, code, retryable }` เมื่อ state = ERROR (ไม่ใช่ผลสินค้า) |
| `replaying`, `speed`, `has_buffered_response` | สถานะเสริม |

### 5. "Captured inspection image" + กรอบ

`captured_image` คือ Blob เดียวกับที่ส่ง `POST /api/inspections` และ `result.bbox` อยู่ในพิกัด pixel ของภาพนั้น (`result.image_width/height`)
จึงส่งเข้า `InspectionOverlay` ของ 01 ได้ตรง ๆ:

```tsx
const capturedUrl = useObjectUrl(snap?.captured_image ?? null)   // สร้าง/revoke object URL ใน 01
<InspectionOverlay src={capturedUrl} result={snap?.result ?? null} scanning={snap?.state === 'WAIT_RESULT'} />
```

ข้อควรระวัง: โหมด DEMO ของ 01 คืนพิกัดจาก `examples/` ที่ไม่ได้คำนวณจากภาพนี้จริง — ถ้าจะใช้ภาพสังเคราะห์ให้ใช้ `ds.imageUrl(result, 'original')` แบบเดิมของหน้า

### 6. สถิติ

นับจาก `onCompleted` เท่านั้น (ยิงเมื่อขวดถึงปลายทาง ครั้งเดียวต่อ `inspection_id`) — ไม่นับจาก snapshot และไม่นับ `onReplayed`
Three.js มีขนาดใหญ่ แนะนำให้โหลดหน้า Simulation ด้วย `React.lazy`

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

## ฉาก (02-B)

- สายการผลิต: ช่องปล่อยขวด → สายพาน → **ORIENT** แท่นหมุนพร้อมกล้อง locator → **INSPECT** กล่องครอบกล้องตรวจและไฟ LED → ตัวดัน **REJECT** (แดง) → ตัวดัน **REVIEW** (เหลือง ช่องรอถ่ายใหม่) → สายพาน **PASS** (เขียว)
- หาฉลากที่แท่นหมุน เมื่อเลือกภาพได้แล้ว ขวดจะคงมุมนั้นไว้แล้วเลื่อนไปที่กล่องกล้องตรวจ (`to_inspect`) ก่อนถ่าย
- สายพานและลูกกลิ้งเลื่อนเท่าระยะที่ขวดเคลื่อนจริง และเฉพาะช่วงที่ขวดอยู่
- ขวดในตู้ปล่อยเป็นของตกแต่ง ไม่สร้างผลตรวจหรือ History; ขวดที่กำลังตรวจมีวงแหวนสีฟ้าใต้ขวด
- ป้ายสถานีอยู่หลังสายพานบนเสา ไม่บังขวดหรือกล้อง
- มุมกล้องจัดให้เห็นทั้งเครื่องทุกขนาดหน้าจอ (คำนวณใหม่เมื่อ resize)

## ค่าตั้ง (ปรับได้ใน `machineConfigFrom` / `ControllerOptions`)

| ค่า | ค่าเริ่ม | ชนิดเวลา |
|---|---|---|
| timeout locate / inspect | 15 s / 30 s | เวลาจริง |
| งบค้นหามุมทั้งหมด | 60 s ไม่นับช่วง pause/error | เวลาจริง |
| ความเร็วจำลอง | 0.25x–3x | เวลาจำลอง |
| จำนวนภาพสูงสุด | 12 (`MAX_INSPECTION_VIEWS`) | — |

## การทดสอบ

รันใน `apps/web`: `npm test` และ `npm run build`

- unit: `__tests__/*.test.ts` 55 กรณี — transition ทุกสถานะ, pause/reset/retry/replay, evidence, controller + mock
  และ controller + `createDataSourcePort` กับ DEMO DataSource ของ 01 (PASS, หันหนีทุกมุม → REVIEW, 503 → retry, storage failed)
- e2e (harness นอก repo รอบ M1): PASS/FAIL/REVIEW, ERROR→retry, pause ระหว่างดัน, replay ไม่นับ, remount 15 รอบไม่มี loop ค้าง, WebGL fallback

## ข้อจำกัดที่รู้อยู่

- ยังไม่ได้ทดสอบกับ API จริงหรือภาพขวดจริงจาก 05
- ยังไม่ได้ฝังในหน้า Simulation จริง (รอ 01)
- frame rate วัดได้แค่บน software renderer ในเครื่องทดสอบ ต้องวัดซ้ำบน notebook ของทีม
