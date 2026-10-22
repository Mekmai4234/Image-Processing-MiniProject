# ตรวจหลัง PR #20 merge — 22 ตุลาคม 2026

PR #20 merge แล้วที่ `0268949fb2978763b068b83ab645cfab89090362` เอกสาร review ไม่ระบุ blocker ของ tooling จึงไม่เปลี่ยน validator/importer/evidence gate โดยไม่มีข้อผิดพลาด งานรอบนี้ตรวจฐานรวมล่าสุด `f4872637d3ca769fce2aef3ae0eab8711fc39d20` และเพิ่มเฉพาะหลักฐาน/สถานะของ 05 ไม่แก้ 01–04 หรือ workflow เพื่อซ่อน failures

## ผลที่รันจริง

| ส่วน | ผลล่าสุด |
|---|---|
| Dataset tools | 44 tests ผ่าน |
| Repository | 12 tests และ repository-check ผ่าน |
| Backend | 147/150 cases ผ่าน, 3 cases ไม่ผ่าน, 94 subtests ผ่าน ไม่มี skips |
| Frontend | 109 tests และ production build ผ่าน |
| Browser DEMO | 3 หน้า × 3 ขนาด CSS = 9 screenshot ใหม่ พร้อม AX snapshots และ measurements |
| WebGL/physical webcam/real-data/visual approval | ยังไม่ผ่านเกณฑ์รับงาน; ดูเหตุผลด้านล่าง |

ใช้ Python 3.11.9, Node 24.19.0 และ dependency/lock เดิม คำสั่ง all-suite หยุดเมื่อ Backend ไม่ผ่าน จึงรัน frontend แยก ไม่อ้างว่าทั้งระบบเขียว หลักฐานระบุ commit, dirty flag และ source hashes: [all-suite](reports/smoke-postmerge-2026-10-22.json), [frontend](reports/frontend-postmerge-2026-10-22.json) ตอน all-suite เริ่ม working tree สะอาด; ตอน frontend เริ่มมีรายงานที่สร้างเพิ่มแล้ว จึง dirty=true ตามจริง

```powershell
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/run_checks.py --suite all --npm-cli 05_dataset_testing/.venv/npm-tools/package/bin/npm-cli.js --report path/to/new-all-report.json
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/run_checks.py --suite frontend --npm-cli 05_dataset_testing/.venv/npm-tools/package/bin/npm-cli.js --report path/to/new-frontend-report.json
```

## Backend: ส่งต่อ 04 แก้ test เรื่องวันจัดเก็บ

`test_create_inspection_single_view`, `test_create_inspection_multi_view` และ `test_demo_mode_tags_results_with_is_demo` ใน `apps/backend/tests/api/test_inspections.py` สร้าง path จาก `created_at[:10]` ซึ่งเป็นวันที่ UTC แต่ storage ใช้วันตาม Asia/Bangkok ตาม contract

ตรวจ boundary ด้วยฟังก์ชัน timezone จริง: UTC `2026-10-21T16:59:59` ได้ folder `2026-10-21`; UTC `2026-10-21T17:00:00` และ `22:30:00` ได้ folder `2026-10-22` จึงทำให้ assertions สามจุดหาไฟล์ผิดวัน รายละเอียดและ hashes ของ source อยู่ใน [backend-timezone report](reports/backend-timezone-2026-10-22.json)

ให้ 04 แก้ expected storage date ตาม contract พร้อม regression รอบเที่ยงคืน แล้ว 05 รัน gate ซ้ำ ไม่เปลี่ยน APP_TIMEZONE ไม่ freeze clock เพื่อซ่อนผล ไม่ skip tests ไม่แก้ Backend ของเพื่อน และไม่สรุปว่าระบบทำไฟล์หายจาก failure นี้

## Browser หลักฐานใหม่จากฐานรวม

เปิด local Vite ที่ port 5185 ใช้ DEMO เท่านั้น ไม่เรียก live backend หรือเปิดกล้อง: Simulation → ใช้ชุดภาพตัวอย่าง → ตรวจ → ได้ PASS/นับ 1 → ไป History เห็นรายการใหม่รวมเป็น 5 รายการ

เก็บ Simulation/Webcam/History ที่ CSS 1366×768, 1586×992 และ 390×844 ใน [observations.json](reports/browser-postmerge-2026-10-22/observations.json) พร้อมขนาด PNG จริงและ SHA-256 ไม่มีการ resize ภาพ Provider คืน PNG เล็กกว่า CSS viewport เหมือนเดิม ต้องจับคู่ pixel dimensions กับ reference จริงก่อนทำ diff

ข้อพบเดิมยังทำซ้ำบนฐานรวมล่าสุดได้:

- **01/02:** Simulation route ยังขึ้นข้อความรอคอมโพเนนต์ฉากและมี canvas=0 แม้ feature modules ของ 02 อยู่ใน Git แล้ว จึงยังสร้างหลักฐาน WebGL ที่ mount ใช้งานจริงจาก route นี้ไม่ได้
- **01/04:** Webcam ยังใช้ชื่อสิงห์/คริสตัล 600ml แต่ catalog DEMO ของ shell เป็น Bottle A/B ที่รอยืนยันสินค้า
- **01:** History ที่ CSS width 390 มี document.scrollWidth=475 แทนที่จะจำกัด overflow ในตาราง

หลักฐาน: [Simulation](reports/browser-postmerge-2026-10-22/simulation-1366x768.png), [Webcam](reports/browser-postmerge-2026-10-22/webcam-1366x768.png), [History mobile](reports/browser-postmerge-2026-10-22/history-390x844.png) และ AX snapshots รายขนาดในโฟลเดอร์เดียวกัน ไม่ใช้ screenshot จาก commit เก่าเป็นผลทดสอบของ commit ใหม่นี้

## งานใน review ที่ยังใช้ข้อมูล/มนุษย์จริง

1. **สินค้าสองชนิดและ pilot:** ยังไม่มี catalog/tolerance ที่ทีมยืนยันและ manifest/provenance ที่ผ่าน gate จำนวนใน pilot-plan 180 ภาพยังเป็นเป้าหมาย ไม่เปลี่ยน actual/reviewer หรือ not_started เป็นเก็บแล้ว ภาพ local ใน bt มีหลายสินค้าแต่ไม่ยืนยันต้นทาง/สิทธิ์/กลุ่ม/multi-view; ภาพ AI หรือแก้พื้นหลังที่ทำส่ง DEMO ไม่ใช้เป็นภาพจริงตรวจรับ
2. **Detector/config จริง:** ยังไม่มี dataset/GT ที่ตรวจทานพร้อมประเมิน จึงไม่สร้าง receipts หรือ accuracy/timing สมมุติ ใช้ importer เดิมเมื่อมี raw responses ของ config ที่ล็อกจริง
3. **WebGL/webcam:** สถานะ blocked ตามเหตุผลด้านบน; ไม่ขอสิทธิ์กล้องหรืออ้างผล device-loss โดยไม่ได้ทดสอบฮาร์ดแวร์จริง
4. **Visual approval:** ยังไม่มี reference PNG ที่ตกลงกับทีมและการตรวจโดยมนุษย์ จึงไม่ทำ screenshot เทียบตัวเอง ไม่อ้าง pixel diff เป็น approval รูป screenshot ชุดใหม่นี้เป็น actual สำหรับทวนปัญหาการใช้งานเท่านั้น

อัปเดต [integration checklist](integration-checklist.csv) ให้ผูกหลักฐานใหม่และเพิ่ม blocked cases ของงานต่อหลัง merge ผล metadata ต้อง consistent แต่ strict acceptance ต้องยังไม่ผ่าน ดู [acceptance status ล่าสุด](reports/acceptance-status-2026-10-22.json)

เอกสาร review ต้นทางคงอยู่นอก Git ไม่รวมภาพขวดจริง/AI/.env/DB/storage ใน PR นี้ และไม่ปิดงาน 05 ทั้งส่วน
