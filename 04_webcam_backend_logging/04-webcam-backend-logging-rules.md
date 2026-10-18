# กติกาก่อนเริ่มงาน 04 — Webcam / Backend / เก็บภาพและ Log

โครงการ **Vending Vision — Image Processing MiniProject** • จัดทำ 18 ตุลาคม 2026 • อ้างอิง contract v0.2

เอกสารสำหรับสมาชิกหรือผู้ช่วยเขียนโค้ดก่อนเริ่มงาน เก็บแยกจาก Git ตามคำขอเจ้าของโครงการ ห้ามนำไฟล์กติกานี้เข้า commit โดยอัตโนมัติ

## 1. เป้าหมายและผู้รับผิดชอบ

สมาชิก 04 เชื่อม webcam notebook กับ OpenCV ผ่าน FastAPI และเก็บผล/ภาพจริงที่เปิดดูย้อนหลังได้ ความยาก **4/5** เพราะต้องประสานกล้อง การตอบ API ไฟล์ และ SQLite โดยไม่ตรวจ/บันทึกซ้ำ

คู่ทบทวนหลัก: 03 สำหรับ detector adapter; 01 สำหรับ capture/overlay/History; 05 สำหรับ retry/restart/ไฟล์; 02 สำหรับ cancellation และ ID ชื่อจริงรอทีมกรอก

สถานะปัจจุบัน: ดำเนินการระยะที่ 1–6 เสร็จสมบูรณ์แล้ว (พร้อมเปิด PR ให้ผู้ตรวจทาน)
- Backend (FastAPI): routes ทั้งหมดตาม contract v0.2 ทำงานครบแล้ว (health, products, locate-label, inspections create/list/detail, image safe lookup, review, retry-save, CSV export)
- Persistence & Storage: SQLite DB และ StorageManager ผ่านการรวม decision snapshot และ status ล่าสุดครบถ้วน; restart reconcile จบ save ที่ค้างให้อัตโนมัติ
- ชุดทดสอบอัตโนมัติ (pytest): ผ่าน 41/41 tests (ใช้ STORAGE_ROOT ชั่วคราวต่อ test) รวม idempotency/disk full/restart/face rejection
- Frontend Webcam Module: `CameraPanel` ใน `apps/web/src/features/webcam/` ครบข้อ 5.1–5.3 และ `npm run build` ผ่าน
- การปรับปรุงล่าสุด:
  1. แก้ไขข้อผิดพลาด `[Errno 10048]` (พอร์ต 8000 ชน) พร้อมคู่มือ kill process บน PowerShell
  2. แก้ไข False Positive เมื่อกล้องเห็นใบหน้ามนุษย์: เพิ่ม HSV Skin Filter + Bottle Contour Gate ให้ปฏิเสธหน้ามนุษย์และแนะนำให้นำขวดมาวางตรงกลางแทน
  3. เพิ่มคู่มือการรันระบบเพื่อตรวจสอบ 04 ไว้ใน `apps/backend/README.md` อย่างละเอียด

## 2. อ่านก่อนเริ่ม

- [คู่มือ 04 env / step / process](https://github.com/Mekmai4234/Image-Processing-MiniProject/tree/develop/04_webcam_backend_logging)
- [API contract](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/docs/api-contract.md), [Storage guide](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/docs/storage-guide.md)
- [Architecture](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/docs/architecture.md), [ตัวอย่างผล](https://github.com/Mekmai4234/Image-Processing-MiniProject/tree/develop/examples)
- [สถานะ implementation](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/docs/implementation-status.md), [Git workflow](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/CONTRIBUTING.md)

## ข้อตกลง v0.2 ที่ต้องทำก่อนเชื่อมระบบ

- อ่าน [Configuration](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/develop/docs/configuration.md): root .env, path เทียบ repo root, limit ต่อไฟล์/ต่อ request/จำนวนภาพ/pixels
- Supporting images ที่ใช้ตัดสินต้องเก็บครบเสมอ; SAVE_ROTATION_FRAMES ควบคุมเฉพาะ frame ระหว่างค้นหาที่ไม่ได้ใช้ตัดสิน
- รอบหามุมหมด/timeout ยังเรียก inspections ด้วยภาพหลักและ evidence เพื่อให้เกิด REVIEW ใน History
- Backend ประเมิน coverage/profile เอง; ห้ามให้ client ส่ง PASS/FAIL หรือ verified flag มาเป็นคำตัดสิน
- storage_error เป็น null หรือ {code,message,retryable}; URL ภาพที่ยังไม่บันทึกเป็น null และรักษา index ของ supporting images
- หากจอง DB/idempotency ที่กู้คืนไม่ได้ ให้ operational error 503 ไม่อ้างว่ามีรายการบันทึกถาวร
- 01 รับ page layout/overlay/History; 03 รับ annotation/algorithm; 04 เน้น camera lifecycle, API adapter และ persistence

ทำ upload → inspect → save → History ให้ครบก่อนเพิ่ม auto capture หรือ queue หลายขวด

## 3. ขอบเขตและไฟล์ร่วม

- Backend อยู่ `apps/backend/`: routes, models/schemas, services, database และ storage adapter
- Webcam component อยู่ `apps/web/src/features/webcam/`; 01 ดูแล page layout/overlay/API client กลาง
- 03 ดูแล pure inspection functions; ร่วมกำหนด image decode/EXIF/RGB-BGR ให้ทำในจุดเดียว
- API contract, frontend shared types, requirements และ env example เป็นไฟล์ร่วม เปลี่ยนแล้วต้องแก้ consumer พร้อมกัน
- Backend บันทึกที่เครื่องซึ่งรัน backend จริง หาก deploy server ข้อมูลอยู่ server ไม่ใช่ D: ของผู้เปิดเว็บโดยอัตโนมัติ

## 4. Checklist ก่อนเริ่ม
 
- [x] เริ่มจาก develop ล่าสุดและยืนยัน Python รุ่นร่วมกับ 03 (Python 3.12, .venv พร้อมแล้ว)
- [x] ตกลง input/output detector และความหมาย unknown/null/error ก่อนสร้าง route
- [x] ระบุ WEB_ORIGIN/API base URL และวิธีรัน localhost จริง; ตัวแปร VITE_* ไม่เก็บ secrets
- [x] Resolve STORAGE_ROOT ตาม repo root ให้ได้ absolute path ที่แน่นอนและตรวจเขียนได้
- [x] กำหนด byte limit/pixel limit/ชนิดภาพ และ response schema ตาม contract
- [x] ตกลง IDs/idempotency fingerprint และการจัดคำขอพร้อมกันก่อนเขียน POST inspections (Unique client_request_id ใน SQLite)
- [x] ระบุพฤติกรรม pending/failed/retry/restart รวมกรณี source หายอย่างเป็นลายลักษณ์อักษร (StorageManager & Reconciliation)
- [x] เตรียม temporary storage แยกสำหรับทดสอบ ไม่ใช้ภาพ capture ของผู้ใช้เป็น fixture ที่แก้ไขได้ (storage/pending/<id>/)

## 5. Input / Output และ API

รับ image, expected_product, source_mode, client_request_id, optional angle_deg และ supporting_images/evidence ตาม contract v0.2; ส่งผลที่ detector ตรวจจริง พร้อม `inspection_id`, image dimensions, config/timing, storage status และ image URLs

Routes ที่เอกสารวางแผนไว้: health/products, locate-label, inspections create/list/detail, image lookup, retry-save, CSV export และ human review ดูรูปแบบ field ล่าสุดใน API contract; รายการนี้ไม่ใช่คำยืนยันว่า implement แล้ว

- Locator สำหรับเลือกมุมไม่สร้าง History ทุก frame
- ตรวจ decode จริง ไม่เชื่อ extension/MIME เพียงอย่างเดียว; จำกัดขนาดก่อนประมวลผลหนัก
- Invalid image/input เป็น 4xx; service unavailable เป็น operational error; ไม่ใช้ FAIL แทน API error
- `client_request_id` เดิม + payload/config context เดิมต้องคืน inspection เดิม; payload ต่างคืน 409 ตาม contract ห้ามสร้าง record ซ้ำจาก race condition
- อย่าให้ config เปลี่ยนแล้ว retry request เดิมกลายเป็นการตรวจใหม่เงียบ ๆ; เก็บ config ที่ใช้กับ inspection ไว้
- Cancellation ฝั่ง browser ไม่รับประกันหยุด backend; รักษา record ของงานที่ตรวจ/บันทึกแล้วและให้ client ละทิ้ง response เก่า

## 6. กฎ Webcam

1. เปิดกล้องหลังผู้ใช้กดและ browser อนุญาต รองรับ permission denied/no device/device lost พร้อมข้อความที่แก้ไขได้
2. เริ่ม manual capture ก่อน auto; ใช้ขนาด frame จริงจาก video ไม่ใช้ CSS size
3. Preview อาจ mirror แต่ภาพส่งตรวจต้องมี orientation ที่ตกลงและกรอบแสดงแกนเดียวกับภาพผลตรวจ
4. Locator จำกัดความถี่และมีคำขอค้างไม่เกินหนึ่งครั้ง; ไม่ยิงทุก frame จน backend ค้าง
5. คำแนะนำ “หมุนช้า ๆ / หยุดนิ่ง / เบลอ” ต้องมาจาก evidence/quality ที่วัดได้; ผู้ใช้หมุนขวดจริงเอง
6. เมื่อเปลี่ยนสินค้า/ภาพ/รอบงานให้ยกเลิกหรือทิ้งผลเก่าตาม id; capture ครั้งใหม่มี request id ใหม่
7. ออกจากหน้า/หยุด/เปลี่ยน device ต้อง stop tracks และยกเลิก loops/listeners; กลับเข้าใหม่ต้องไม่เปิดหลาย stream ซ้อน
8. ถ้าต่อยอด auto capture ต้องมี stable window, cooldown และการยืนยันขวดรอบใหม่ เพื่อไม่บันทึกใบเดิมซ้ำรัว

## 7. กฎบันทึกจริงและ History

```text
storage/inspections.sqlite3
storage/<วันที่ไทย>/<pass|fail|review>/<inspection_id>/
  original.jpg
  annotated.jpg
  result.json
  supporting/0.jpg  (เมื่อใช้ภาพหลักฐานเพิ่มเติม)
storage/pending/<inspection_id>/...
```

1. `created_at` เป็น UTC; วันที่โฟลเดอร์และหน้าจอใช้ Asia/Bangkok ตาม config
2. Original หมายถึงภาพที่ใช้ตรวจหลัง normalize EXIF; annotated เป็นอีกไฟล์ ไม่วาดทับ original หากต้องเก็บ upload bytes ให้มี source เพิ่มตาม contract
3. สร้าง/เก็บ pending state → เขียน temp ภายใน storage root → rename ไฟล์ → ตรวจครบ → saved; DB กับหลายไฟล์ไม่ใช่ transaction atomic เดียวกัน
4. การเขียนบางส่วนล้มเหลวต้อง failed/pending พร้อมเหตุผลและร่องรอยที่กู้ได้; result PASS/FAIL/REVIEW เดิมคงอยู่
5. result.json เป็น decision snapshot คงเดิม ไม่เก็บสถานะบันทึก/review ที่เปลี่ยนได้; SQLite เก็บสถานะล่าสุดและ GET รวมเป็น response ต้องอ้าง ID เดียวกัน หลัง restart reconcile pending/failed และห้าม saved หากหลักฐานขาด
6. retry-save ใช้ inspection เดิม ไม่ตรวจภาพซ้ำจนได้คำตอบใหม่; ถ้า source หายและกู้ไม่ได้ให้แจ้งถ่ายใหม่อย่างชัดเจน
7. GET image ใช้ inspection id + kind lookup ภายใน root ไม่รับ arbitrary filesystem path และไม่ส่ง `file://` ให้ frontend
8. History มี pagination/filter ที่ validate; CSV สร้างจาก query เดียวกันใน DB ตอน export ไม่ append แข่งหลาย process
9. Human review เก็บ reviewed_result/reviewed_reason/reviewer/reviewed_at แยก prediction เดิม; อย่าย้ายผลเดิมจน audit ไม่ได้
10. Reset simulation ไม่ลบภาพหรือประวัติ; ไม่เพิ่มการลบจริง/retention อัตโนมัติโดยไม่ได้ออกแบบเป็นงานเฉพาะ

## 8. เกณฑ์รับงานและหลักฐาน

- [ ] กล้องจริง capture ได้ ปฏิเสธสิทธิ์แล้วลองใหม่ได้ และออกหน้าแล้วไฟกล้องดับ (โค้ด CameraPanel + build พร้อม แต่ **ยังต้องทดสอบมือบน notebook จริงก่อนติ๊ก**)
- [x] ภาพทั้งสองโหมดเข้าตัวตรวจเดียวกัน; coordinate/orientation ตรง original และ annotated (ผ่านการทดสอบใน test_inspections.py)
- [x] ส่งคำขอ id เดียวซ้ำ/พร้อมกันได้ record เดียว; เปลี่ยน payload ด้วย id เดิมคืน conflict (ผ่านการทดสอบ Idempotency ใน test_repository.py และ test_inspections.py)
- [x] Backend restart แล้วยังอ่าน saved History และไฟล์ได้; pending ที่ขาดไฟล์ไม่กลายเป็น saved (ผ่านการทดสอบใน test_storage.py และ StorageManager.reconcile_on_startup)
- [x] จำลองเขียนไม่ได้/partial write ด้วย temp storage แล้ว result ไม่เปลี่ยน, retry ไม่สร้างรายการใหม่ (ผ่านการทดสอบใน test_storage.py และ test_repository.py)
- [x] ทดสอบ invalid upload/too large/unknown id/image kind/timeout และ UI แยก ERROR ได้ (ผ่านการทดสอบใน test_locate.py และ test_inspections.py)
- [x] CSV กับ History ใช้ filters เดียวกันและจำนวนรายการตรงข้อมูลจริง (ผ่านการทดสอบใน test_history_and_export.py)
- [x] บอก path เก็บจริง คำสั่งรัน รุ่น environment และหลักฐานไฟล์ original/annotated/result ที่เป็น inspection เดียวกัน (บันทึกใน apps/backend/README.md)

## 9. ส่งงานและข้อควรระวัง

ใช้ branch งานย่อย เช่น `feature/04-inspection-api`, `feature/04-webcam-capture`, `fix/04-storage-recovery` จาก develop ล่าสุด ส่ง PR เข้า develop พร้อมวิธีรันและทดสอบ ขอ 03/01/05 review ตามส่วนที่แตะ

อัปเดต contract/examples/consumer และ implementation status ตามจริง ไม่ commit `.env`, SQLite, storage, ภาพกล้องจริง หรือกติกาฉบับนี้

จุดพลาดหลักคือบันทึกซ้ำจาก retry, เลือก PASS เพราะระบบเขียนไฟล์ได้, คืน saved ก่อนมีไฟล์ครบ, restart แล้ว DB/ไฟล์ไม่ตรงกัน และลืมปิด media tracks ผู้ช่วยเขียนโค้ดต้องตรวจพฤติกรรมเหล่านี้ด้วยการรันจริงก่อนสรุปว่างานเสร็จ

## 10. สรุปสำหรับ Pull Request และ Checklist ผู้ตรวจ

**Branch:** `feature/04-webcam-backend` → PR เข้า `develop` • **ผู้ตรวจ:** 03 (adapter/ตัวตรวจ), 01 (webcam UI/overlay/API client), 05 (restart/ไฟล์/test)

**สิ่งที่ PR นี้เพิ่ม:** Backend FastAPI + SQLite + StorageManager (`apps/backend/`), โมดูลกล้อง (`apps/web/src/features/webcam/`) พร้อม Vite/React skeleton ขั้นต่ำ (`package.json`, `vite.config.ts`, `src/lib/api.ts`, `src/types/inspection.ts`, `App.tsx`) เพื่อให้รันทดสอบได้ — **01 ตรวจว่าตรงกับ app shell ที่ตั้งใจและย้าย/แทนที่ได้**

**รันตรวจเอง:**

```powershell
.\.venv\Scripts\pytest.exe apps/backend/tests -q            # 40 passed
.\.venv\Scripts\python.exe scripts/check_repository.py       # OK
cd apps/web; npm ci; npm run build                           # ผ่าน
.\.venv\Scripts\uvicorn.exe app.main:app --app-dir apps/backend --port 8000
cd apps/web; npm run dev                                     # http://127.0.0.1:5173
```

**Checklist ผู้ตรวจ**

- [ ] (03) `InspectionAdapter.inspect/locate` เป็น baseline ชั่วคราว: signature/ผลลัพธ์ตรงที่ตกลง และแทนที่ด้วยของจริงได้ไม่กระทบ route
- [ ] (03) decode/EXIF ทำจุดเดียว (`decode_and_normalize`); bbox อยู่ในพิกัดภาพหลังแก้ EXIF
- [ ] (01) `src/lib/api.ts` และ `types/inspection.ts` ตรง contract v0.2; ไม่ชนกับ API client กลางที่ 01 จะทำ
- [ ] (01) Mirror preview แต่ภาพที่ส่งตรวจไม่ mirror; overlay แปลงพิกัดตาม object-fit/mirror ถูกต้อง
- [ ] (05) ทดสอบ restart: ปิด backend ตอนมี pending แล้วเปิดใหม่ → ไม่ขึ้น saved ถ้าไฟล์ไม่ครบ
- [ ] (05) ไม่มี `.env`, SQLite, `storage/`, ภาพกล้องจริงใน diff; test ไม่เขียนลง `storage/` จริง
- [ ] ทุกคน: เปิดกล้องจริงบน notebook — ขอ/ปฏิเสธสิทธิ์, สลับกล้อง, ออกหน้า/กดปิดแล้วไฟกล้องดับ, ไม่เปิด stream ซ้อน

**จุดที่ผู้ตรวจควรดูเป็นพิเศษ (ผลจากการตรวจย้อนระยะ 1–5)**

1. Idempotency เดิมเทียบแค่ product/mode/angle → แก้เป็น SHA-256 ของ payload ทั้งหมด (ภาพ+evidence) + migration คอลัมน์ `payload_fingerprint`
2. Reconcile ตอน startup เดิมไม่บันทึกต่อไฟล์ที่ค้างใน `pending/` → ตอนนี้ re-save ให้
3. Test เดิมเขียนลง `storage/` จริง → แยก temp storage ต่อ test
4. `useWebcamStream` เดิมมี bug: stream ที่เพิ่งเปิดถูกหยุดทันทีเมื่อ `activeDeviceId` เปลี่ยน → cleanup เหลือเฉพาะตอน unmount
5. ปุ่มเลือกสินค้าเดิมใส่ชื่อยี่ห้อที่ยังไม่ได้ตัดสินใจ → ใช้ชื่อจาก `/api/products`

**ข้อจำกัดที่ยอมรับใน PR นี้:** ตัวตรวจ baseline รอ 03; ยังไม่มี browser automation test; หน้า Simulation/History เป็นของ 01/02

**Commit:** ไม่ stage ไฟล์กติกานี้ ใช้ `git add apps/backend apps/web .gitignore docs README.md` ตามชื่อไฟล์ ห้าม `git add .`
