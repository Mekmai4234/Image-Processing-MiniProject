# Backend Workspace — Vending Vision

ระบบหลังบ้าน (Backend) สำหรับโครงการ **Vending Vision — Image Processing MiniProject**  
พัฒนาด้วย **FastAPI**, **SQLite** และ **OpenCV** ทำหน้าที่เป็นแกนกลางในการเชื่อมต่อกล้อง Webcam, รับภาพส่งตรวจ และบันทึกประวัติ/ไฟล์ภาพจริงลงเครื่อง

---

## 1. ภาพรวมของโปรเจกต์ (Vending Vision)

ระบบตรวจจับและตรวจสอบฉลากขวดน้ำดื่มไทยด้วย Image Processing พร้อมจำลองสายพานคัดแยก 3D โดยแบ่งออกเป็น 3 หน้าเว็บบนระบบ:
1. **Simulation**: อัปโหลดรูปขวด แล้วจำลองการวิ่งบนสายพาน 3D (Feed, หมุนหาฉลาก, ตรวจ, ดีดคัดแยก)
2. **Webcam**: เปิดกล้องโน้ตบุ๊ก ให้ผู้ใช้ถือและหมุนขวดด้วยมือ ระบบจะตรวจจับและถ่ายภาพส่งไปตรวจสอบ
3. **History**: ตรวจสอบประวัติย้อนหลัง ดูรูปจริง (Original) และรูปตีกรอบ (Annotated), กรองผลตรวจ (`PASS` / `FAIL` / `REVIEW`) และ Export ออกเป็นไฟล์ CSV

### การแบ่งหน้าที่ในทีม 5 คน
- **01 (Web UI)**: โครงหน้าเว็บ React, Layout 3 หน้า, Overlay กรอบผลตรวจ
- **02 (Simulation 3D)**: สายพาน 3D, โมเดลขวด, แท่นหมุนขวด
- **03 (Image Processing)**: อัลกอริทึม OpenCV คัดแยกฉลาก ตรวจความถูกต้อง คุณภาพ และตำแหน่ง
- **04 (Webcam / Backend / Logging) — งานโฟลเดอร์นี้**: แกนกลาง Backend (FastAPI), ฐานข้อมูล (SQLite), บันทึกไฟล์ภาพ/ผลตรวจลงเครื่อง และโมดูลกล้อง Webcam บนหน้าเว็บ
- **05 (Dataset / Testing)**: จัดเตรียม Dataset, Ground truth, และวัดผล Accuracy

---

## 2. หน้าที่หลักของงาน 04 (Webcam / Backend / Logging)

1. **ฝั่ง Backend (`apps/backend/`)**:
   - พัฒนา REST API ด้วย FastAPI ตามข้อกำหนด [api-contract.md](../../docs/api-contract.md)
   - ทำตัวแปลง (Adapter) เชื่อมต่อฟังก์ชัน Image Processing ของคนที่ 03
   - จัดการฐานข้อมูล SQLite (`storage/inspections.sqlite3`) เก็บประวัติการตรวจ
   - จัดเก็บไฟล์ภาพจริงลงไดรฟ์เครื่องตามโฟลเดอร์วันที่ (`storage/YYYY-MM-DD/<pass|fail|review>/<id>/...`) ตาม [storage-guide.md](../../docs/storage-guide.md)
   - ป้องกันการบันทึกซ้ำด้วย Idempotency (`client_request_id`) และจัดการสถานะการเขียนไฟล์ (`pending` → `saved` / `failed`) พร้อมระบบ Retry/Recovery
2. **ฝั่ง Frontend (`apps/web/src/features/webcam/`)**:
   - สร้างคอมโพเนนต์ `CameraPanel` เพื่อขอสิทธิ์และเปิดกล้องจากโน้ตบุ๊ก
   - จัดการปิด Stream/Track ของกล้องให้สนิทเมื่อผู้ใช้เปลี่ยนหน้า
   - มีระบบดึงภาพไปเช็คตำแหน่งฉลาก (`/api/locate-label`) เป็นระยะ เพื่อแนะนำผู้ใช้ เช่น "หมุนช้าๆ", "ภาพเบลอ"
   - ปุ่มกดถ่ายภาพ (Capture) ส่งไปตรวจที่ Backend

---

## 3. แผนการดำเนินงานและสถานะปัจจุบัน (Roadmap & Progress Tracker)

- [x] **ระยะที่ 1: เตรียมโครงสร้าง Backend และระบบ Configuration** *(เสร็จสิ้น)*
  - [x] **ข้อ 1.1:** สร้างโครงสร้างโปรเจกต์ Backend ใน `apps/backend/app/` และเขียน Config Loader โหลด `.env` จาก REPO_ROOT คำนวณ Path แน่นอน
  - [x] **ข้อ 1.2:** สร้าง `apps/backend/app/main.py` ตั้งค่า CORS Middleware (รองรับทั้ง localhost และ 127.0.0.1) และพัฒนา `GET /api/health`, `GET /api/products`
- [x] **ระยะที่ 2: ระบบฐานข้อมูล SQLite และการจัดเก็บไฟล์ภาพ (Persistence)** *(เสร็จสิ้น)*
  - [x] **ข้อ 2.1:** ออกแบบและสร้างระบบ SQLite (`storage/inspections.sqlite3`, Table `inspections`, Indexes, Idempotency, Human Review)
  - [x] **ข้อ 2.2:** พัฒนาระบบ `StorageManager` จัดการโฟลเดอร์ตามวันที่ไทย (`YYYY-MM-DD/<result>/<id>/`), กลไก Pending Staging, Atomic Move, Safe Image Lookup และ Startup Reconciliation
- [x] **ระยะที่ 3: ระบบเชื่อมต่อตัวตรวจและ Inspection API** *(เสร็จสิ้น)*
  - [x] **ข้อ 3.1:** สร้าง `InspectionAdapter` เชื่อมต่อโมดูล Image Processing พร้อม Skin Tone / Contour Filter และ Mock/Fallback Interface
  - [x] **ข้อ 3.2:** พัฒนา `POST /api/locate-label` (ตรวจคุณภาพภาพ, คัดกรองใบหน้ามนุษย์, และตำแหน่ง bbox แบบ throttled ไม่ลง History)
  - [x] **ข้อ 3.3:** พัฒนา `POST /api/inspections` (รับภาพหลัก + supporting images + evidence, Idempotency, บันทึก DB & Storage)
- [x] **ระยะที่ 4: Endpoints สำหรับ History, รูปภาพ, และ Export** *(เสร็จสิ้น)*
  - [x] **ข้อ 4.1:** พัฒนา `GET /api/inspections` (Filter, Pagination) และ `GET /api/inspections/{id}`
  - [x] **ข้อ 4.2:** พัฒนา Endpoint ดึงรูปภาพปลอดภัย `GET /api/inspections/{id}/images/{kind}` และ `/supporting/{index}`
  - [x] **ข้อ 4.3:** พัฒนา `GET /api/exports/inspections.csv`, `PATCH /api/inspections/{id}/review` และ `POST /api/inspections/{id}/retry-save`
- [x] **ระยะที่ 5: พัฒนาโมดูลกล้อง Webcam บน Frontend (`apps/web/`)** *(เสร็จสิ้น)*
  - [x] **ข้อ 5.1:** สร้างคอมโพเนนต์ `CameraPanel` (`getUserMedia`, Live Preview, Memory/Track Cleanup ปิดกล้องสนิทเมื่อเปลี่ยนหน้า)
  - [x] **ข้อ 5.2:** เชื่อมระบบ Locator Guidance ("กรุณานำขวดน้ำมาไว้ตรงกลางกรอบ", "กรุณาหมุนขวด...", "พบฉลากชัดเจนพร้อมถ่าย", "ภาพเบลอ")
  - [x] **ข้อ 5.3:** เชื่อมระบบ Capture ภาพจริงส่งไปตรวจที่ Backend พร้อมสลับสินค้าและแสดงผลการตรวจทันที
- [x] **ระยะที่ 6: การทดสอบและการเขียนคู่มือ** *(เสร็จสิ้น)*
  - [x] **ข้อ 6.1:** เขียน Automated Tests (41 tests ครอบคลุม Config, SQLite, Storage Resilience, API, Reconcile, Face Rejection)
  - [x] **ข้อ 6.2:** สรุปคู่มือวิธีรัน, การแก้ปัญหา Port 10048, และระบบแยกแยะใบหน้ามนุษย์

---

## 4. โครงสร้างไฟล์ในโฟลเดอร์ Backend

```text
apps/backend/
├── app/
│   ├── main.py              # FastAPI app หลัก, CORS, lifespan startup validation & reconciliation
│   ├── api/
│   │   ├── router.py        # API router รวม (/api)
│   │   └── routes/          # health, products, locate, inspections, exports
│   ├── core/
│   │   ├── config.py        # โหลด .env จาก REPO_ROOT, path resolution และ limits
│   │   ├── timezone.py      # จัดการ Asia/Bangkok และ ISO-8601 UTC
│   │   └── errors.py        # จัดการ API Error รูปแบบมาตรฐาน
│   ├── db/
│   │   ├── connection.py    # SQLite connection, WAL mode และ table schema
│   │   └── repository.py    # InspectionRepository (CRUD, Idempotency, Status updates)
│   ├── models/
│   │   └── schemas.py       # Pydantic schemas (Health, Products, Locator, Inspections)
│   └── services/
│       ├── inspection_adapter.py # Image Processing Adapter, Skin Filter, Face Rejection, Label Locator
│       ├── inspection_service.py # Orchestrator ตรวจสอบและบันทึกลง SQLite/Storage
│       └── storage.py       # StorageManager (Pending staging, Atomic move, Safe lookup, Reconciliation)
├── tests/
│   ├── api/                 # ทดสอบ HTTP endpoints, Locate, Inspections, History, Resilience
│   ├── core/                # ทดสอบ config loader และ path resolution
│   ├── db/                  # ทดสอบ SQLite และ Idempotency
│   └── storage/             # ทดสอบการบันทึกไฟล์ภาพและกู้คืน
└── requirements.txt         # รายการ dependencies
```

---

## 5. วิธีการรันระบบเพื่อตรวจสอบงาน 04 (Webcam, Backend & Logging)

เพื่อให้ระบบทำงานครบวงจรและสามารถทดสอบกล้อง Webcam หน้าเว็บคู่กับ Backend ได้ ให้เปิด **PowerShell 2 หน้าต่าง** ดังนี้:

### ขั้นตอนที่ 1: เตรียม Environment (ทำครั้งแรก)
```powershell
# รันที่ Repository Root
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/backend/requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

# ติดตั้ง Frontend Dependencies
cd apps/web
npm install
cd ../..
```

### ขั้นตอนที่ 2: รัน Backend Server (หน้าต่าง Terminal 1)
```powershell
# รันจาก Repository Root เสมอ
.\.venv\Scripts\uvicorn.exe app.main:app --app-dir apps/backend --host 127.0.0.1 --port 8000 --reload
```
เมื่อรันสำเร็จจะแสดงข้อความ:
- `Uvicorn running on http://127.0.0.1:8000`
- Swagger Documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health Check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

### ขั้นตอนที่ 3: รัน Frontend Web (หน้าต่าง Terminal 2)
```powershell
# เปิดหน้าต่าง PowerShell ใหม่ แล้วรัน:
cd apps/web
npm run dev
```
เปิดเว็บเบราว์เซอร์ไปที่: **`http://127.0.0.1:5173/`**

---

## 6. การแก้ปัญหา [Errno 10048] Address already in use

### สาเหตุที่เกิดขึ้น
เกิดจากมีกระบวนการ (Process) เดิมของ Python / Uvicorn เปิดค้างอยู่และกำลังผูกจอง Port 8000 อยู่แล้ว ทำให้เมื่อสั่งรันคำสั่ง `uvicorn` ซ้ำอีกครั้งในหน้าต่างใหม่ ระบบปฏิบัติการ Windows จะปฏิเสธพร้อมข้อผิดพลาด:
`ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000): only one usage of each socket address is normally permitted`

### วิธีแก้ไข (PowerShell)
1. ตรวจสอบว่า Process ID (PID) ใดกำลังใช้งาน Port 8000:
```powershell
Get-NetTCPConnection -LocalPort 8000 | Select-Object LocalAddress, LocalPort, State, OwningProcess
```
2. สั่งปิด Process นั้นทันที (แทนที่ `<PID>` ด้วยตัวเลขที่ได้จากคอลัมน์ OwningProcess เช่น 31832):
```powershell
Stop-Process -Id <PID> -Force
```
3. สั่งรันคำสั่งเปิด Backend ใหม่อีกครั้ง:
```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --app-dir apps/backend --port 8000 --reload
```

---

## 7. คำถาม: หากกล้องเห็นหน้าแล้วระบบบอกว่า "พบฉลากชัดเจนพร้อมถ่าย" ปกติหรือไม่?

### คำตอบ: **"ไม่ปกติครับ"**
ระบบนี้คือระบบตรวจจับฉลากขวดน้ำดื่ม (Bottle Label Inspection) การที่กล้องส่องเห็นใบหน้าหรือร่างกายมนุษย์ แล้วระบบแจ้งว่าพบฉลากขวดน้ำ ถือเป็น **ข้อผิดพลาด (False Positive)**

### สาเหตุที่เกิดในเวอร์ชันก่อนหน้า
ในโค้ดตัวอย่างขั้นต้น (Mock Baseline) ฟังก์ชัน `locate_label()` ตรวจเพียงแค่ค่าความคมชัดของภาพ (`Laplacian blur variance >= 40.0`) โดยไม่ได้ตรวจจับวัตถุจริง เมื่อกล้องหันไปเห็นใบหน้าคนที่มีความคมชัด (มีเส้นตา, ปาก, จมูก, ผม) ค่าความคมชัดจึงผ่านเกณฑ์ ทำให้ Mock ตีความไปเองว่า `usable_view = True`

### สิ่งที่ได้แก้ไขแล้วใน `apps/backend/app/services/inspection_adapter.py`:
1. **Skin/Face Rejection Gate (HSV Skin Range Filter)**:
   - แปลง ROI กึ่งกลางภาพเป็นปริภูมิสี HSV และตรวจสัดส่วนเฉดสีผิวคน (Hue: 0–25, Saturation: 30–200, Value: 60–255)
   - หากพบสัดส่วนสีผิวเกิน 35% ระบบจะปฏิเสธทันที (`usable_view: false`, `bottle_visible: false`, `label_visible: false`)
   - ระบบจะแนะนำผู้ใช้ว่า: **"กรุณานำขวดน้ำมาไว้ตรงกลางกรอบ"** แทนที่จะรายงานว่าพบฉลาก
2. **Bottle Contour & Aspect Ratio Gate**:
   - ค้นหาเส้นขอบวัตถุทรงกระบอกแนวตั้ง (Vertical Cylindrical Contour) ภายในกรอบไกด์ หากไม่มีขวดน้ำอยู่จริง จะไม่ผ่าน
3. **Label Contrast & Texture Gate**:
   - วัดความแตกต่างของเส้นขอบฉลาก (Label Edge Density) และค่าความเปรียบต่าง (Standard Deviation)
   - หากหันหลังขวดที่เป็นพลาสติกใสไร้ฉลาก ระบบจะตรวจพบขวดแต่แจ้งเตือนว่า: **"กรุณาหมุนขวดให้เห็นฉลากด้านหน้า"**
   - จะขึ้น **"พบฉลากชัดเจน พร้อมถ่ายภาพ"** (กรอบสีเขียว) ก็ต่อเมื่อนำขวดน้ำที่มีฉลากด้านหน้าเข้ามาในระยะและองศาที่ถูกต้องเท่านั้น

---

## 8. การรัน Automated Tests ทั้งหมด

```powershell
# รันชุดทดสอบ Backend ทั้งหมด (41 tests)
.\.venv\Scripts\pytest.exe apps/backend/tests -v

# ตรวจสอบโค้ด Frontend Web และ Typescript Build
npm --prefix apps/web run build

# ตรวจสอบความถูกต้องของโครงสร้างทั้ง Repository
.\.venv\Scripts\python.exe scripts/check_repository.py
```
