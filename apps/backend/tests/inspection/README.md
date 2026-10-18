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

เมื่อต้องเตรียมเครื่องใหม่ ใช้ Python 3.11 ที่มี แล้วติดตั้งเฉพาะใน environment ของ 03:

```powershell
py -m venv apps/backend/tests/inspection/.venv
& .\apps\backend\tests\inspection\.venv\Scripts\python.exe -m pip install numpy==2.4.6 opencv-python-headless==5.0.0.93
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
