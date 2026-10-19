# features/simulation — งาน 02 (Three.js conveyor)

สถานะ: **ใช้ได้กับ mock (DEMO) เท่านั้น** ยังไม่ได้ต่อ API จริง เพราะ app shell ของ 01 และ endpoint ของ 04 ยังไม่มี
อ้างอิง [API contract v0.2](../../../../../docs/api-contract.md) และ [architecture](../../../../../docs/architecture.md)

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `machine/` | state machine แบบ pure function (`transition`) + การคำนวณ evidence + ตำแหน่ง (`poseOf`) ไม่มี timer/fetch/Three.js |
| `controller/` | `SimulationController` รัน effect: เรียก API พร้อม AbortController และ timeout เวลาจริง, simulation clock, กันนับซ้ำ |
| `scene/` | `ConveyorScene` วาดจาก state อย่างเดียว + `FallbackDiagram` เมื่อไม่มี WebGL |
| `api/` | `InspectionPort`, mock (DEMO), adapter HTTP ชั่วคราว, type ของ contract |
| `SimulationScene.tsx` | React component ให้ 01 ฝัง |

## วิธีฝังในหน้า Simulation (สำหรับ 01)

```tsx
import { SimulationScene, machineConfigFrom, parseSimulationDefaults } from '@/features/simulation'

// defaults มาจาก GET /api/products → simulation_defaults (ไม่อ่าน .env จาก browser)
const config = machineConfigFrom(parseSimulationDefaults(products) ?? undefined)

<SimulationScene
  ref={sceneRef}                // start(job) / pause / resume / reset / retry / replay / setSpeed
  port={port}                   // adapter ของ client ร่วม หรือ MockInspectionPort (แสดงป้าย DEMO)
  config={config}               // เปลี่ยนค่า → เปลี่ยน key เพื่อ remount
  onSnapshot={setSnapshot}      // สถานะ/มุม/สถานี/ผล/error (ไม่ยิงทุกเฟรม)
  onCompleted={countAndRefresh} // ครั้งเดียวต่อ inspection_id เมื่อขวดถึงปลายทาง → ใช้นับสถิติ
/>
```

`sceneRef.current.start({ expected_product, views: [{ angle_deg, image }] })` คืนรายการปัญหาของ input (ว่าง = เริ่มแล้ว)
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

ยังไม่มี package.json ใน `apps/web` จึงทดสอบด้วย harness นอก repo (Vite + Vitest + Playwright)
หลัง 01 ตั้ง app แล้วให้ย้ายคำสั่งเข้า `apps/web/package.json`:

- unit: `vitest run` ครอบ `__tests__/*.test.ts` (44 กรณี: transition ทุกสถานะ, pause/reset/retry/replay, evidence, controller + mock)
- e2e (harness): PASS/FAIL/REVIEW, ERROR→retry, pause ระหว่างดัน, replay ไม่นับ, remount 15 รอบไม่มี loop ค้าง, WebGL fallback

## ข้อจำกัดที่รู้อยู่

- ยังไม่ได้ทดสอบกับ API จริงหรือภาพขวดจริงจาก 05
- `api/contract.ts` เป็นสำเนา type ชั่วคราว ต้องเปลี่ยนไปใช้ `src/types/inspection.ts` เมื่อ 01 สร้าง
- `api/httpPort.ts` เป็น adapter ชั่วคราว ต้องเปลี่ยนไปใช้ client ร่วมของ 01
- frame rate วัดได้แค่บน software renderer ในเครื่องทดสอบ ต้องวัดซ้ำบน notebook ของทีม
