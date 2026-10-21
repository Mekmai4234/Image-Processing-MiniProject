# การทดสอบงาน 03

ทดสอบด้วย unittest และภาพสังเคราะห์ที่สร้างในหน่วยความจำ ไม่ต้องมี Webcam,
API, SQLite หรือ dataset จริง และไม่เขียนภาพ/ฐานข้อมูลของผู้ใช้
tests มี configuration ที่ระบุชัดว่าเป็น synthetic-tests-only เพื่อทดสอบเส้นทาง
PASS/FAIL; ไม่ใช่หลักฐานว่า config ผ่าน validation กับขวดจริง

## รันจาก repository root ใน PowerShell

เครื่องที่ทำงานรอบนี้สร้าง environment เฉพาะ 03 ไว้แล้วใน `.venv` ภายในโฟลเดอร์นี้:

```powershell
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -B -m unittest discover -s apps/backend/tests/inspection -p 'test_*.py' -v
```

หรือเรียก entry point ของ 03 ซึ่งหา tests จากตำแหน่งไฟล์ ไม่ขึ้นกับ working directory:

```powershell
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -B apps/backend/tests/inspection/run_checks.py
```

เมื่อต้องเตรียมเครื่องใหม่ ใช้ Python 3.11 ที่มี แล้วติดตั้งเฉพาะใน environment ของ 03:

```powershell
py -m venv apps/backend/tests/inspection/.venv
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -m pip install -r apps/backend/tests/inspection/requirements-test.txt
```

เวอร์ชันข้างต้นเป็นรุ่นที่รันทดสอบในรอบนี้ ไม่ใช่ dependency lock ของ Backend รวม
requirements/config/CI ของส่วนอื่นไม่ได้ถูกแก้ `.venv` ถูก ignore โดยกฎเดิมของ repository

## หลักฐานการทดสอบ 18 ตุลาคม 2026

- Python 3.11.16, numpy 2.4.6, opencv-python-headless 5.0.0.93 บน Windows
- 43 unittest methods ผ่าน ครอบคลุม subcases เพิ่มเติมในบาง methods
- PASS ของสินค้าสังเคราะห์สองชนิด, wrong-label score สูง, displaced/tilted label,
  unknown/tied match, ภาพเบลอ, ไม่เห็นฉลาก, cropped bottle, หลายขวดและพื้นหลังซับซ้อน
- RGB/BGR, ภาพขนาดสองเท่าคืนกรอบพิกัดเต็ม, annotation ไม่แก้ original,
  expected ROI เส้นประโดยไม่สร้าง detected bbox, output serialize เป็น finite JSON
- invalid pixels/config/metadata, limits ต่อภาพ/ภาพรวม/จำนวนมุม, flat/invalid score
- ค่า coverage จาก client, timeout/exhaustion, supporting image indexes,
  ภาพหลักไม่พอแม้ภาพเสริมใช้ได้ และห้าม PASS/FAIL ด้วย config ที่ยังไม่ validate
- ตรวจโครงสร้าง repository และ regression ของสคริปต์เดิมแยกจาก detector tests

ผลนี้ยืนยันพฤติกรรมของ baseline บน fixtures เท่านั้น ไม่มี real-data accuracy,
confusion matrix หรือ median/p95 สำหรับภาพขวดจริง การทดสอบ Webcam/API/Storage
และ final evaluation ต้องทำร่วมกับ 04/05 หลังมีข้อมูลจริงและ adapter

## งานต่อจาก review — 19 ตุลาคม 2026

เพิ่ม 13 handoff contract tests รวมเดิม 43 เป็น 56 tests ผ่านบน environment เดิม
ทดสอบ projection ของ Decision ไป fields ของ 03 ใน API, mapping expected/detected,
เหตุผล wrong/misplaced, exception boundaries, null supporting URLs ตาม index,
ไม่วาด bbox ของภาพเสริมบนภาพหลัก และการแก้ dict โดย adapter ไม่แก้ Decision เดิม
test เทียบชื่อ fields กับตัวอย่าง contract ใน repository โดยไม่แก้ examples
การผ่าน tests เหล่านี้ยังไม่ใช่การทดสอบ HTTP/DB/persistence จริงของ 04

สำหรับ 04/05 เมื่อต้องเพิ่ม detector tests เข้า CI ใช้ขั้นตอนต่อไปนี้ใน workflow
ส่วนกลางภายหลัง (รอบนี้ยังไม่แก้ `.github/`):

```text
python -m pip install -r apps/backend/tests/inspection/requirements-test.txt
python -B apps/backend/tests/inspection/run_checks.py
```

runner คืน exit code 0 เมื่อผ่าน, 1 เมื่อ test ล้มเหลว และ 2 เมื่อไม่พบ tests
unittest import errors ทำให้ run ล้มเหลวด้วย ไม่รายงานเขียวเมื่อ dependency หาย
คำสั่งเดิมแบบ unittest discover ยังใช้ได้ tests ไม่ใช้ API/network/storage จริง
requirements-test.txt เป็นรุ่น environment ที่ตรวจแล้วของ 03 ไม่ใช่ lock ฝั่ง Backend รวม

## ใบงานใหม่ — 21 ตุลาคม 2026

ผลรันจริงบน Windows / Python 3.11.16, numpy 2.4.6, OpenCV 5.0.0.93:

- core unittest 86 methods ผ่าน (เดิม 56 + config/provenance/shape/annotation/locator edge cases)
- core + HTTP integration 92 methods ผ่าน รวม 6 HTTP methods ที่มีหลาย subcases
- pytest ของ Backend ทั้งหมด 150 tests ผ่าน และ 94 subtests ผ่าน
- repository-check และ regression ของ repository scripts ตรวจแยกตาม workflow เดิม

config tests ใช้ report fixture เพื่อทดสอบ binding เท่านั้น ไม่มี report ที่ประเมินขวดจริง
กรณี face/hand/clear outline/reflection เป็นภาพวาดทดสอบ ไม่แทนผลบนภาพจริง
shape tests ตรวจทรงตรง/สอบ/เว้าเอว และ fallback ไม่มี real-data accuracy/shape quality metrics

### HTTP integration ในเครื่อง

```powershell
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -m pip install -r apps/backend/tests/inspection/requirements-integration.txt
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -B apps/backend/tests/inspection/run_checks.py --integration
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -B -m pytest apps/backend/tests -q -p no:cacheprovider
```

HTTP tests ใช้ app/routes/adapter/03 detector/DB/storage จริงและภาพสังเคราะห์ ใน temporary
STORAGE_ROOT เท่านั้น ตั้ง config ผ่านจุด inject ที่มีอยู่ของ 04 แล้วคืนค่าหลังทุก test
ไม่ mock run_detector_03 ไม่แทนที่ HTTP locator และไม่แก้ app ของ 04
ครอบคลุมสองโหมด good/wrong/position/blur/hidden/unknown, EXIF/RGB/BGR/พิกัด,
อ่านภาพ original/annotated ที่ saved, supporting images, unvalidated REVIEW และ missing config 503

shared locator/score annotation bridge ทดสอบโดยเรียก 03 ตรง ๆ ร่วมกับ decoder/inspect ของ 04
**HTTP locator เดิมและ stored annotation ของ 04 ยังไม่เปลี่ยน** ตามขอบเขตที่ผู้ใช้ยืนยัน
ให้ 04 นำขั้นตอนใน HANDOFF ไปต่อก่อนประกาศว่าปัญหา locator รวมระบบได้รับการแก้แล้ว
HTTP tests ไม่อ้างว่าภาพ stored ของ 04 มีคะแนนแล้ว; แยกทดสอบคะแนนบน annotate_fields ของ 03

Integration environment รอบนี้ใช้ FastAPI 0.156.4 / Starlette 1.9.0 / httpx 0.28.1 /
Pillow 13.0.0 / pytest 9.1.1 และแสดง deprecation warning จาก TestClient ของ dependencies
หนึ่งรายการ tests ผ่าน ไม่ปรับ requirements รวมของ 04 เพื่อปิด warning ในงาน 03
core runner ไม่บังคับ dependency HTTP; ใช้ --integration หลังติดตั้ง integration requirements

### ภาพหลักฐานสังเคราะห์

```powershell
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -B apps/backend/tests/inspection/render_preview.py --output apps/backend/tests/inspection/.venv/verification-2026-10-21.png
```

ภาพรวมแสดง PASS/FAIL/REVIEW, score ที่คำนวณจริงจาก fixture, detected/expected boxes,
contour/profile ของสามรูปทรงและ fallback มีป้าย SYNTHETIC ชัดเจน ไม่ใช่ภาพ reference ขวดจริง
ไฟล์ภาพอยู่ใน environment ที่ ignore ไม่ส่งเข้า Git และไม่เขียน storage จริง
ข้อกำหนดข้อมูล 04/05 และ shape transport 02 อยู่ในเอกสาร CONFIGURATION/SHAPE/HANDOFF ของ 03
