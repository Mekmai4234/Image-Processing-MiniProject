# ผลตรวจงาน 05 — 21 ตุลาคม 2026

**ผลใหม่ 22 ตุลาคม 2026:** ตรวจ commit รวม `f4872637d3ca769fce2aef3ae0eab8711fc39d20` หลัง PR #20 merge ได้ dataset tools 44/repository 12/frontend 109 tests และ build ผ่าน แต่ Backend ผ่าน 147/150 cases + 94 subtests มี 3 failure เรื่อง UTC/Bangkok storage date assertions ไม่มี skips เก็บ screenshot ใหม่ 9 ภาพและทวน defects เดิมแล้ว ยังไม่ผ่าน real-data/hardware/visual acceptance รายละเอียด [รายงานหลัง merge](POSTMERGE-2026-10-22.md) ผลวันที่ 21 ด้านล่างเป็นประวัติของ commit เก่า ไม่ใช้ยืนยันว่า gate ปัจจุบันผ่าน

ฐานแอปที่ตรวจ: `2569e7ced6e1f4fc788791ab0530b10faea2ace4` จาก develop พร้อม working tree ของงาน 05 รอบนี้ รายงาน JSON บันทึก dirty flag และ SHA-256 ของ source ที่ใช้ทดสอบ จึงไม่ได้อ้างว่าเครื่องมือใหม่อยู่ใน base commit แล้ว

รอบตรวจซ้ำตามใบงานทั้งสองฉบับ ใช้ฐานเครื่องมือ `fbfe73c4823539252129920200aea7d9a10c8ed3` พร้อม working tree ที่แก้เฉพาะ 05 ดู [smoke-recheck-2026-10-21.json](reports/smoke-recheck-2026-10-21.json) ซึ่งเก็บ commit/dirty flag/source hashes ตามที่รันจริง หลักฐาน browser เดิมยังคงอ้างฐานเดิม ไม่อ้างว่าถ่าย browser ใหม่ในรอบนี้

ผู้ใช้ยืนยันว่าไม่มีชุดภาพจริงและ reference PNG จึงยังไม่มี accuracy/final-test metrics หรือ visual comparison ที่ผ่านการรับรอง ผลด้านล่างเป็นการทดสอบ code paths และเว็บจริงด้วย DEMO เท่านั้น

## สภาพแวดล้อมและคำสั่ง

- Windows, Python 3.11.9, Pillow 12.3.0, NumPy 2.4.6, OpenCV headless 5.0.0.93
- Node.js 24.19.0; ติดตั้ง frontend ด้วย npm ci จาก lock เดิม ไม่เปลี่ยน package.json/lock
- Python smoke environment ใช้ dependency pins ใน requirements-smoke.txt ของ 05 แยกจากแอป
- รายงานรวม: [smoke-2026-10-21.json](reports/smoke-2026-10-21.json)

```powershell
py -3.11 -m venv 05_dataset_testing/.venv/qa311
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -m pip install -r 05_dataset_testing/requirements-smoke.txt
npm ci --prefix apps/web
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/run_checks.py --suite all --report path/to/new-report.json
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/evidence.py --checklist 05_dataset_testing/integration-checklist.csv
```

เครื่องนี้ไม่มี npm บน PATH จึงเรียก npm-cli.js ที่ติดตั้งไว้ในโฟลเดอร์ local ที่ ignore ผ่าน --npm-cli เมื่อรัน gate ใน CI ใช้ npm จาก setup-node ปกติ Python 3.12 และ Node 22.12.0 จะตรวจโดย CI matrix; ไม่อ้างผล local ของรุ่นที่ไม่ได้รัน

## ผลทดสอบ

| รายการ | ผล / ขอบเขต |
|---|---|
| Dataset/เครื่องมือ 05 | รอบล่าสุด 44 tests ผ่าน (ฐานเดิม 38 + เพิ่ม 6); synthetic fixtures เท่านั้น |
| Repository regression | 12 tests ผ่าน พร้อม repository-check |
| Backend/03 detector/04 HTTP และ storage | 150 test cases ผ่าน + 94 subtests ผ่าน; JUnit นับรวม 244 |
| Frontend Vitest | 71 tests ผ่าน |
| Frontend production build | ผ่าน; ไม่ใช่ visual approval |
| Browser จริง | navigation 3 หน้า, DEMO inspect และ History store ทำงานในขอบเขตที่บันทึก |
| Screenshot baseline | 3 หน้า × 3 CSS viewport = 9 PNG; ไม่มี PNG ต้นแบบให้ diff |
| Real-data / กล้องจริง | ยังไม่ได้ทดสอบ; ไม่มีภาพจริงหรือ permission/hardware evidence |

Backend ใช้ TestClient เรียก routes จริงและ detector จริงบนภาพสังเคราะห์ ผ่าน temporary DB/files ของ fixtures เดิม ไม่ใช้ runtime storage ผู้ใช้ มี deprecation warning จาก FastAPI/Starlette test client กับ httpx หนึ่งรายการ ไม่ลด assertions หรือ skip เพื่อให้ผ่าน

Smoke runner ปฏิเสธ suite ที่ไม่มี tests, มี failures/errors/skips หรือ dependencies ไม่พร้อม เก็บ failure report ด้วยเมื่อคำสั่งทดสอบล้มเหลว ไม่ถือ synthetic suite เป็นหลักฐานรับรอง accuracy

## การตรวจซ้ำและ acceptance gate รอบนี้

- อ่านใบงานข้อตกลงร่วมและ 05-A ถึง 05-E แล้วสรุปสถานะใน [STATUS.md](STATUS.md) สิ่งที่ยังต้องใช้ข้อมูลจริง/ทีมยังไม่ถือว่าจบ
- เพิ่ม regression ของ HTTP single-view receipts ที่มี supporting images/angles หรือ verified coverage ขัดกับ single-view และข้อมูล evidence/timing ผิดชนิด เพื่อไม่ให้ปนเข้า metrics
- เพิ่มสรุป checklist ที่แยก records_consistent กับ ready_for_acceptance และ strict CLI gate เมื่อไม่มีหลักฐาน real/browser/hardware/visual ครบ
- ปฏิเสธใช้ screenshot ไฟล์เดียวเป็น actual และ reference โดยตรง; การตรวจที่มาของไฟล์ reference ที่คัดลอกยังต้องให้มนุษย์ทวน
- รัน smoke ทั้งหมดใหม่ได้ 44 dataset + 12 repository + 150 backend/94 subtests + 71 frontend และ build ผ่าน ไม่มี test skips; warning ของ TestClient เดิมหนึ่งรายการยังรายงานไว้
- รัน evidence.py แบบตรวจ records ผ่าน แต่ `--require-complete` คืน 1 ตามที่คาด เพราะยังมีเคสค้าง/failed และข้อมูลจริง/กล้อง/visual ไม่ครบ รายละเอียดอยู่ใน [acceptance status](reports/acceptance-status-2026-10-21.json) นี่ไม่ใช่ test regression ที่ต้องซ่อนหรือแก้ expected ให้เขียว
- ไม่รวมไฟล์เครื่องมือ/แบบถ่ายภาพส่ง 02 จากคำขอที่ยกเลิก ไฟล์เหล่านั้นถูกเก็บสำรองเฉพาะ local ignored folder และไม่อยู่ใน tests หรือ commit รอบนี้

คำสั่ง smoke รอบล่าสุดใช้ `05_dataset_testing/.venv/qa311/Scripts/python.exe -B 05_dataset_testing/run_checks.py --suite all --npm-cli 05_dataset_testing/.venv/npm-tools/package/bin/npm-cli.js --report 05_dataset_testing/reports/smoke-recheck-2026-10-21.json` บน Windows ไม่มีการเปลี่ยน package/lock ของ frontend หรือโค้ด backend

## การแก้และตรวจเฉพาะ 05

- รักษา regression สำหรับ misplaced_label ที่ต้องมีฉลาก/เห็นพอ/ตำแหน่งผิด
- เพิ่มกฎปฏิเสธ known wrong label ที่ถูกให้ misplaced_label ตาม precedence quality → identity → position ของ pipeline 03 ปัจจุบัน เคสกำกวมยังต้องให้ 03/05 ทวนกับภาพ pilot
- เพิ่ม pilot แผน 180 ภาพ ทุกแถวยัง not_started: 2 สินค้า × 3 กลุ่มอิสระ × 6 conditions × 5 ภาพ จำนวน actual/reviewer ว่างตามความจริง
- เพิ่ม HTTP receipt importer แยก predictions ออกจาก GT ปฏิเสธ DEMO และ multi-view ที่ยังไม่ได้ตกลงหน่วยประเมิน
- เพิ่ม validator ของ evidence, strict smoke gate และภาพเทียบ/diff ที่ต้อง human review
- เพิ่ม workflow ของ 05 แยกจาก workflow กลาง ไม่แก้แอป/fixtures หรือ package/lock ของ 01–04

## Browser evidence และข้อบกพร่อง

ใช้ browser จริงเปิด Vite /simulation → DEMO → ใช้ชุดภาพตัวอย่าง → ตรวจ ได้ PASS แล้วไป History พบรายการใหม่ใน store เดียวกัน บันทึก DOM snapshots และ screenshot ที่ 1586×992, 1366×768 และ 390×844 โดยไม่เปิดกล้องจริง

พบ 3 ประเด็นส่งต่อเจ้าของส่วนใน [DEFECTS.md](DEFECTS.md): scene 3D ยังเป็น placeholder, Webcam มีชื่อสินค้า hardcode ต่างจาก catalog กลาง และ History จอเล็กกว้างเกิน viewport (475px เทียบ 390px) ไม่แก้ implementation ของเจ้าของส่วนและไม่เปลี่ยนเคสเหล่านี้เป็นผ่าน

ภาพที่บันทึกเป็น DEMO baseline ไม่ใช่ reference ต้นแบบ ไม่ได้ทำภาพเทียบต้นแบบปลอม ไม่ได้รับรอง layout ว่าตรงต้นแบบ และยังต้องให้เจ้าของโครงการ review ภาพ/flow จริงเมื่อได้รับ reference และแก้ defects

Provider คืน PNG ที่ขนาด pixel ต่างจาก CSS viewport ที่ร้องขอ (ตัวอย่าง CSS 1586×992 ได้ PNG 1571×982) บันทึก requested viewport, PNG dimensions และ hash ใน [captures.json](reports/browser/captures.json) ไม่ resize หลักฐานเพื่ออ้างว่าตรงต้นแบบ ต้องถ่ายใหม่ให้ pixel dimensions ตรง reference ก่อนใช้ screenshot diff

## งานที่ยังต้องทำกับทีม

เลือกสินค้า/ขนาด/tolerance, ถ่าย pilot และทวน GT, validate profiles/thresholds ด้วย validation, ทำ config audit ที่ตรงกับ loader, lock final test แล้ววัด metrics จริงแยกโหมด กำหนด multi-view job protocol ก่อนประเมิน ไม่เอา final test กลับมาปรับแล้วอ้างผลเดิม

ยังไม่เพิ่ม validated=true ให้สินค้า/config และไม่เปิด GT missing_label จริงจากมุมที่ client รายงาน Integration checklist แยกข้อมูลจริง/hardware ที่ not_tested/blocked จาก smoke/browser ที่มีหลักฐานแล้ว

เอกสารแนบทั้งสองฉบับยังอยู่นอก repository ไม่มี dataset จริง/.env/DB/runtime captures เข้า Git รายงานนี้ไม่ปิดงาน 05 ทั้งส่วน และ PR ต้อง review ก่อน merge
