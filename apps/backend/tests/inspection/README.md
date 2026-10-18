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
