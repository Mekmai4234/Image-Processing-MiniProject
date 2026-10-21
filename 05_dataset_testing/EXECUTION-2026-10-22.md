# ดำเนินงานต่อ 4 ข้อ — 22 ตุลาคม 2026

ฐานแอป: `f4872637d3ca769fce2aef3ae0eab8711fc39d20` โค้ดเพิ่มอยู่ใน 05 เท่านั้น ไม่มีการแก้ implementation ของ 01–04 งานนี้ต่อจากหลักฐาน Draft PR #34 โดยไม่เปลี่ยนงานที่ติดข้อจำกัดให้เป็นผ่าน

## 1. สินค้าจริงและ pilot — ยังรอข้อมูลยืนยัน

มีไฟล์ภาพ local จากผู้ใช้ 7 ภาพ แต่เป็นหลายสินค้าและยังไม่มีการยืนยันแหล่งภาพ/สิทธิ์/ขนาด/รหัสขวด/session/GT ภาพหลายมุมจริงของขวดใบเดียวไม่มี และไม่มีสินค้า 2 รุ่น/tolerance ที่ทีมตกลงแล้ว จึงไม่กรอกแผน pilot 180 ภาพเป็นจำนวนที่เก็บสำเร็จ และไม่ใช้ภาพ AI หรือแก้พื้นหลังแทนข้อมูลจริง

ถามผู้ใช้แล้วให้ระบุสินค้าสองชนิด รุ่น/ขนาด ภาพที่ถ่ายเองและอนุญาตใช้ และ path ของ reference ที่ทีมตกลง ต้องได้รับข้อมูลนี้ก่อนล็อก catalog, ตรวจทาน GT, แบ่งกลุ่มจริง และประเมิน final test ห้ามนำรูปขวดใดที่เลือกเองไปเป็นสินค้า approved โดยอัตโนมัติ

## 2. เรียก Backend จริงและ import — ทำ readiness probe แล้ว; ยังไม่มี product metrics

เพิ่ม [probe_backend.py](probe_backend.py) เรียก FastAPI routes จริงผ่าน TestClient ใน temporary storage ที่ตรวจสอบ path แล้ว โดยบังคับ DEFAULT_TO_DEMO=false/ALLOW_DEMO_MODE=false ไม่แต่งหรือติดตั้ง config ให้ detector เก็บ raw responses, input SHA-256, UUID และ HTTP status ไว้ก่อน import

รันกับภาพ local 7 ไฟล์: detector_ready=false, HTTP **503 ทั้ง 7 ครั้ง**, history_total=0 catalog ที่ server ส่งยังเป็น Bottle A/B, brand/size=null, references ว่าง และ validated=false นี่คือ preflight ที่ยืนยันว่าไม่มี real configuration พร้อม ไม่ใช่ detector ทำขวดตก 7 ครั้ง และไม่ใช่ผล accuracy

นำ raw receipts ผ่าน import_predictions.py จริงแล้วได้ **7 rows ของ operational errors** ไม่มี PASS/FAIL/REVIEW หรือ timing ที่แต่งขึ้น เก็บ receipts/predictions และภาพต้นทางเฉพาะ datasets/ ที่ ignore รายงานสาธารณะเก็บเพียงสรุปและ hashes ไม่รวมรูป

```powershell
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/probe_backend.py --input-root C:/path/to/source-images --output datasets/probes/new-run --expected-product bottle_a
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/import_predictions.py --receipts datasets/probes/new-run/receipts.jsonl --output datasets/probes/new-run/predictions.csv
```

รหัส expected-product ใน probe เป็น request context จาก catalog ปัจจุบัน ไม่ใช่ GT ของรูป เครื่องมือคืน 1 เมื่อ config ยังไม่พร้อม, 2 เมื่อ input/dependency/IO มีปัญหา ไม่ทับ output เดิม ต้องใช้ process ใหม่เพื่อ isolate settings ไม่มีการเปิด live server/เขียน storage ของผู้ใช้

## 3. WebGL/browser/webcam — เพิ่มหลักฐาน component แล้ว; integrated/hardware ยังไม่ครบ

เพิ่ม [browser harness](browser-harness/README.md) ที่ import public component ของ 02 ด้วย config ของ 05 เอง ไม่แก้หน้า Simulation ของ 01 ทดสอบ WebGL ใน browser จริง ใช้ mock port ที่ติดป้าย DEMO แยกจาก real API และบันทึกจำนวน requests/completions/replays ใน DOM

หลักฐานใน [reports/execution-2026-10-22](reports/execution-2026-10-22) ระบุ source hashes/commit กับข้อมูลจำลองอย่างชัดเจน ผลนี้ไม่เปลี่ยน defect ว่า integrated route ยังเป็น placeholder และไม่ได้แปลว่าเว็บหลักผ่าน end-to-end; ยังต้องให้ 01/02 ต่อหน้าและทวนอีกครั้ง ไม่มี physical webcam/bottle/permission/device-loss run

ผลที่บันทึกจาก browser: WebGL มี canvas=1; PASS/FAIL/REVIEW จบ COMPLETE ไป pass/reject/review ตามลำดับ; replay คง inspect_requests=1/completed=1 และเพิ่ม replayed=1; pause อยู่ PAUSED/FEED ระหว่างสอง observation แล้ว resume จบ REVIEW ได้; forced 2D fallback มี canvas=0 และยังจบ PASS; reset กลับ IDLE ไม่มีคำขอตรวจเพิ่ม ไม่ยืนยันว่าใช้ GPU จริงหรือผ่าน hardware performance ข้อมูลใน harness ไม่ใช่ผลของ detector

## 4. Visual comparison และมนุษย์ตรวจ — ยังรอ reference/ผู้ตรวจ

ไม่ได้รับ reference PNG ที่ทีมตกลง จึงไม่สร้าง reference จาก screenshot เว็บตัวเองและไม่ใส่ visual approval แทนมนุษย์ ภาพ harness ใช้ตรวจ functional behavior เท่านั้น เมื่อมี reference ต้อง capture pixel dimensions เท่ากัน ใช้ compare_screenshots.py แล้วให้คนที่ทีมระบุทวน semantic/layout ตามจุดรับงาน การ diff ผ่านไม่อนุมัติหน้าตาเอง

## ขอบเขตส่งงาน

รอบนี้ทำเครื่องมือและทดสอบ runtime เพิ่มได้ แต่ **ยังทำครบ 4 ข้อแบบตรวจรับจริงไม่ได้** จนกว่าจะมี approved products/dataset/config, physical webcam และ agreed reference/human review ไม่เปลี่ยน assertions ของ Backend ที่ยังล้ม 3 tests และไม่สรุปว่า CI ทั้งระบบเขียว

ผลทดสอบ: 47 dataset tools + 12 repository ผ่าน, frontend 109 tests/build ผ่าน, harness production build ผ่าน (มีคำเตือนขนาด Three.js bundle) ส่วน Backend 147/150 cases และ 94 subtests ผ่าน แต่ 3 cases ล้ม ไม่มี skips [all-suite report](reports/execution-2026-10-22/smoke.json) จึงเป็น failed ตามจริง ส่วน [frontend report](reports/execution-2026-10-22/frontend.json) เป็น passed รายงานผูก base commit และ source hashes ของ working tree; harness source hashes อยู่ใน [execution summary](reports/execution-2026-10-22/summary.json)
