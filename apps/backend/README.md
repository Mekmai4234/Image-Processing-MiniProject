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
  - [x] **ข้อ 1.2:** สร้าง `apps/backend/app/main.py` ตั้งค่า CORS Middleware และพัฒนา `GET /api/health`, `GET /api/products`
- [x] **ระยะที่ 2: ระบบฐานข้อมูล SQLite และการจัดเก็บไฟล์ภาพ (Persistence)** *(เสร็จสิ้น)*
  - [x] **ข้อ 2.1:** ออกแบบและสร้างระบบ SQLite (`storage/inspections.sqlite3`, Table `inspections`, Indexes, Idempotency, Human Review)
  - [x] **ข้อ 2.2:** พัฒนาระบบ `StorageManager` จัดการโฟลเดอร์ตามวันที่ไทย (`YYYY-MM-DD/<result>/<id>/`), กลไก Pending Staging, Atomic Move, Safe Image Lookup และ Startup Reconciliation
- [ ] **ระยะที่ 3: ระบบเชื่อมต่อตัวตรวจและ Inspection API** *(ขั้นตอนถัดไป)*
  - [ ] **ข้อ 3.1:** สร้าง Adapter เชื่อมต่อโมดูล Image Processing (คนที่ 03) พร้อม Mock/Fallback Interface
  - [ ] **ข้อ 3.2:** พัฒนา `POST /api/locate-label` (ตรวจคุณภาพภาพและตำแหน่ง bbox แบบ throttled ไม่ลง History)
  - [ ] **ข้อ 3.3:** พัฒนา `POST /api/inspections` (รับภาพหลัก + supporting images + evidence, Idempotency, บันทึก DB & Storage)
- [ ] **ระยะที่ 4: Endpoints สำหรับ History, รูปภาพ, และ Export**
  - [ ] **ข้อ 4.1:** พัฒนา `GET /api/inspections` (Filter, Pagination) และ `GET /api/inspections/{id}`
  - [ ] **ข้อ 4.2:** พัฒนา Endpoint ดึงรูปภาพปลอดภัย `GET /api/inspections/{id}/images/{kind}` และ `/supporting/{index}`
  - [ ] **ข้อ 4.3:** พัฒนา `GET /api/exports/inspections.csv`, `PATCH /api/inspections/{id}/review` และ `POST /api/inspections/{id}/retry-save`
- [ ] **ระยะที่ 5: พัฒนาโมดูลกล้อง Webcam บน Frontend (`apps/web/`)**
  - [ ] **ข้อ 5.1:** สร้างคอมโพเนนต์ `CameraPanel` (`getUserMedia`, Live Preview, Memory/Track Cleanup)
  - [ ] **ข้อ 5.2:** เชื่อมระบบ Locator Guidance ("หมุนช้าๆ", "หยุดนิ่ง", "ภาพเบลอ")
  - [ ] **ข้อ 5.3:** เชื่อมระบบ Capture ภาพจริงส่งไปตรวจที่ Backend
- [ ] **ระยะที่ 6: การทดสอบและการเขียนคู่มือ**
  - [ ] **ข้อ 6.1:** เขียน Automated Tests ครอบคลุม API, Storage Recovery, Idempotency conflict
  - [ ] **ข้อ 6.2:** สรุปคู่มือวิธีรันและเกณฑ์การส่งมอบงาน

---

## 4. โครงสร้างไฟล์ในโฟลเดอร์ Backend

```text
apps/backend/
├── app/
│   ├── main.py              # FastAPI app หลัก, CORS, lifespan startup validation & reconciliation
│   ├── api/
│   │   ├── router.py        # API router รวม (/api)
│   │   └── routes/          # route handlers (/api/health, /api/products)
│   ├── core/
│   │   ├── config.py        # โหลด .env จาก REPO_ROOT, path resolution และ limits
│   │   ├── timezone.py      # จัดการ Asia/Bangkok และ ISO-8601 UTC
│   │   └── errors.py        # จัดการ API Error รูปแบบมาตรฐาน
│   ├── db/
│   │   ├── connection.py    # SQLite connection, WAL mode และ table schema
│   │   └── repository.py    # InspectionRepository (CRUD, Idempotency, Status updates)
│   ├── models/
│   │   └── schemas.py       # Pydantic schemas (Health, Products, SimulationDefaults)
│   └── services/
│       └── storage.py       # StorageManager (Pending staging, Atomic move, Safe lookup)
├── tests/
│   ├── api/                 # ทดสอบ HTTP endpoints
│   ├── core/                # ทดสอบ config loader และ path resolution
│   ├── db/                  # ทดสอบ SQLite และ Idempotency
│   └── storage/             # ทดสอบการบันทึกไฟล์ภาพและกู้คืน
└── requirements.txt         # รายการ dependencies
```

---

## 5. การติดตั้งและการเริ่มใช้งาน (PowerShell)

### เตรียม Environment และ Dependencies

```powershell
# ที่ Repository Root
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/backend/requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

### รัน Backend Dev Server

```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000 --app-dir apps/backend --reload
```

- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health Check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- Products Catalog: [http://127.0.0.1:8000/api/products](http://127.0.0.1:8000/api/products)

### รันชุดทดสอบ (Automated Tests)

```powershell
.\.venv\Scripts\pytest.exe apps/backend/tests -v
```

---

## 6. โครงสร้างการจัดเก็บข้อมูลจริง (Persistence & Storage)

ระบบจะจัดเก็บไฟล์ลงใน `STORAGE_ROOT` (ค่าเริ่มต้นคือ `./storage` ที่ Repository Root):

```text
storage/
├── inspections.sqlite3       # ฐานข้อมูลประวัติและสถานะล่าสุด (WAL mode)
├── pending/
│   └── <inspection_id>/      # พักไฟล์ชั่วคราวระหว่างบันทึก
└── <YYYY-MM-DD (เวลาไทย)>/
    └── <pass|fail|review>/
        └── <inspection_id>/
            ├── original.jpg  # ภาพจริงที่ใช้ตรวจ (แก้มุม EXIF แล้ว)
            ├── annotated.jpg # ภาพพร้อมวาดกรอบผลตรวจ
            ├── result.json   # Decision snapshot (บันทึกคงเดิม ไม่แก้หลังสร้าง)
            └── supporting/   # ภาพหลักฐานหลายมุม (index: 0.jpg, 1.jpg, ...)
```
