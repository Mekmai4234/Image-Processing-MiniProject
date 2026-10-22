# Frontend workspace — Vending Vision web

สถานะ: app shell 3 หน้า (Simulation / Webcam / History) รันได้แล้ว พร้อมโหมด DEMO
ยังไม่มีฉาก Three.js (02), CameraPanel (04) และ Backend endpoints จริง
01 เป็นเจ้าของ app shell, 02 เพิ่ม simulation, 04 เพิ่ม webcam
ใช้ React + TypeScript + Vite; Three.js สำหรับฉากจำลอง

```text
src/pages/                 SimulationPage, WebcamPage, HistoryPage (01)
src/pages/slots.ts         ร่าง props ที่ 02/04 จะฝังเข้ามา (ตกลงก่อนเชื่อม)
src/components/            InspectionOverlay, ResultCard, AppShell (01)
src/features/simulation/   Three.js scene/state (02)
src/features/webcam/       CameraPanel/capture/cleanup (04)
src/lib/api.ts             API client กลาง (01/04)
src/lib/dataSource.ts      สลับ API จริง / DEMO ผ่าน interface เดียว
src/demo/                  ข้อมูลสังเคราะห์จาก examples/ (ป้าย DEMO เสมอ)
src/types/inspection.ts    shared contract v0.2 (01/03/04)
```

## วิธีรัน

ต้องใช้ Node.js 22.12+ (ทีมตกลงสาย 22 ตาม 01_web_ui/env.txt) และ npm

```powershell
# ที่ repository root: สร้าง .env ครั้งแรกเท่านั้น
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

cd apps/web
npm ci            # ติดตั้งตาม package-lock.json
npm run dev       # http://localhost:5173
npm run build     # typecheck + build ไป dist/
npm test          # unit tests (geometry, contract form, มุมภาพ, DEMO data)
npm run preview   # เปิด build ที่ http://localhost:4173
```

- Port dev = 5173 แบบ strictPort ให้ตรง `WEB_ORIGIN=http://localhost:5173` ของ Backend
- Browser อ่านเฉพาะ `VITE_API_BASE_URL` (ค่าเริ่ม `http://127.0.0.1:8000`) แก้ .env แล้วต้อง restart dev server
- `localhost` กับ `127.0.0.1` เป็นคนละ origin สำหรับ CORS

## แหล่งข้อมูล: API จริง / DEMO

ปุ่มมุมขวาบนสลับแหล่งข้อมูล ทุกหน้าเรียกผ่าน `DataSource` เดียว ไม่ปน mock ในโค้ดหน้า

- **API จริง**: เรียก Backend ตาม [API contract](../../docs/api-contract.md) ถ้าติดต่อไม่ได้จะแสดงแถบ ERROR พร้อมปุ่มลองใหม่
- **DEMO**: ใช้ `examples/*.json` (demo=true) และภาพสังเคราะห์ที่วาดตรงพิกัด bbox เลือกสถานการณ์ได้
  (PASS, FAIL wrong_label, REVIEW เบลอ, REVIEW หามุมไม่สำเร็จ, บันทึกไม่สำเร็จ, ERROR 503) เพื่อทดสอบหน้าจอ
  ไม่ได้ตรวจภาพจริง และส่งออก CSV ไม่ได้

## กติกาที่โค้ดนี้บังคับ

- กรอบใช้ `scale = min(W/Iw, H/Ih)` + offset ของ object-fit: contain และ mirror ตามภาพ (`src/lib/geometry.ts`)
- `bbox` วาดเส้นทึบ, `expected_bbox` วาดเส้นประพร้อมป้าย "บริเวณที่ควรมีฉลาก" เท่านั้น
- ระหว่างรอผลไม่แสดง PASS; เปลี่ยนภาพ/สินค้า/รีเซ็ตแล้วตัดผลเก่าทิ้ง (`useInspectionRun`)
- รอบตรวจใหม่สร้าง `client_request_id` ใหม่; ปุ่มลองใหม่ส่ง payload เดิมด้วย id เดิม
- ภาพอัปโหลดเริ่มที่ "ไม่ทราบมุม" (null) จนผู้ใช้เลือกเอง ชุดภาพ DEMO เท่านั้นที่กำหนดมุมไว้ล่วงหน้า (`src/lib/views.ts`)
- หน้า Simulation ส่งชุดภาพให้ฉากของ 02 ผ่าน `toJobInput` ฉากเป็นผู้หมุนหามุม สร้างคำขอและ evidence เอง (ส่งคำขอเดียว)
  ภาพเดียวไม่ต้องมีมุม; หลายภาพต้องระบุมุมจริงทุกภาพและยืนยันว่าเป็นขวดใบเดียวกัน
- สถิติหน้า Simulation นับจาก `onCompleted` ครั้งเดียวต่อ `inspection_id` เท่านั้น เล่นซ้ำไม่นับ (`src/lib/simSession.ts`)
- `port`/`config` ของฉาก memo ไว้ (config จากตัวเลข simulation_defaults ไม่ใช่ object catalog) เพื่อไม่ให้ฉาก reset กลางงาน
- หน้า Simulation โหลดแบบ lazy เพราะ Three.js ใหญ่ หน้า Webcam/History ไม่ต้องโหลด
- ผลสินค้าแยกจากสถานะบันทึก เช่น "PASS / บันทึกไม่สำเร็จ"; API error แสดง ERROR ไม่ใช่ FAIL
- `match_score` แสดงเป็น "ความคล้าย" และ null แสดง "—"
- สถิติ History คำนวณจาก `total` ของ API ตาม filter ไม่ hardcode

## Config และไฟล์ร่วม

ตั้ง envDir เป็น repository root ด้วย absolute path ที่คำนวณจากตำแหน่ง vite.config.ts
คง envPrefix เป็น VITE_; ดู [configuration](../../docs/configuration.md)
01 รับผิดชอบ package.json/package-lock.json, Vite config และ shared API client
02/04 ขอเพิ่ม dependency ผ่าน PR ประสาน 01 และ commit lockfile ที่ตรงกัน
UI library: ไม่ใช้ชุด UI สำเร็จรูป ใช้ CSS ของโปรเจกต์ (`src/styles/global.css`) และไอคอน lucide-react
