# วิธีทดสอบ

## Gate ที่มีอยู่ตอนนี้

`python scripts/check_repository.py` ตรวจเอกสารครบ 15 ไฟล์ ลิงก์ภายใน
JSON score/bbox/result และ CSV fields; CI ชื่อ repository-check
ไม่อ้างว่า check นี้ทดสอบ OpenCV, Webcam หรือ scene ที่ยังไม่พัฒนา

## Gate ที่เพิ่มพร้อม implementation

| ส่วน | กรณีจำเป็น |
|---|---|
| UI | bbox ตรงเมื่อ resize/letterbox/mirror, empty/error, keyboard |
| Scene | wait result, pause/reset/late response, correct output, replay ไม่เก็บซ้ำ |
| Inspection | PASS/FAIL/REVIEW, high-score wrong label, hidden label, no candidate |
| Camera | deny permission/no device, capture, close tracks, cooldown |
| Storage/API | invalid upload, max dimensions, duplicate id, write failure, restart history |

integration ใช้ temp directory/SQLite test DB ไม่แตะ storage ของผู้ใช้
ตัวอย่าง CSV/JSON ไม่ใช้แทนผล accuracy บนภาพจริง

## Final evaluation

แยก confusion matrix ตาม mode/product/สภาพแสง และรวม REVIEW เป็นคลาส
false_pass = GT FAIL predicted PASS / GT FAIL ทั้งหมด
false_reject = GT PASS predicted FAIL / GT PASS ทั้งหมด
review_rate = predicted REVIEW / จำนวน valid inspections
แยก operational error ออกจาก denominator ของภาพที่ตรวจสำเร็จและรายงานจำนวน error เพิ่ม
หาก denominator=0 ใช้ N/A ไม่ใส่ 0% หลอกว่าระบบไม่มีความผิดพลาด
เก็บ median/p95 timing, sample counts, resolution, hardware, config_version และ dataset version
ตั้งเป้าจาก baseline ก่อนเปิด test set ไม่แก้เป้าเพื่อให้ผลที่วัดผ่าน

ทุก PR เพิ่มการทดสอบตามความเสี่ยงที่แก้ พร้อมคำสั่งรันที่ทำซ้ำได้

## Regression ของตัวตรวจ repository

รัน python -m unittest discover -s scripts -p "test_*.py" -v
ใช้ fixture ใน temporary directory เพื่อลองกรณี sample หาย, field ผิด, split รั่ว
และ Markdown ใน dependencies/local data ที่ไม่ควรถูกสแกน
CI ตรวจ synthetic examples เท่านั้น; dataset จริงยังต้องใช้เครื่องมือตรวจของ 05
