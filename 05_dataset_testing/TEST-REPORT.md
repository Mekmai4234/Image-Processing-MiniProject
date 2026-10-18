# ผลตรวจงาน 05 — 19 ตุลาคม 2026

สถานะ: เครื่องมือ offline สำหรับงาน 05 พร้อมใช้งานตามขอบเขตที่ระบุใน README ยังไม่ใช่ผลประเมิน detector หรือการทดสอบระบบจริง

## สภาพแวดล้อมที่ใช้

- Windows / PowerShell
- Python 3.14.0 ใน `05_dataset_testing/.venv`
- Pillow 12.3.0 (pin ใน requirements ของ 05 เท่านั้น)
- Python 3.11/3.12 ตามแผน Backend ยังไม่ได้ทดสอบ compatibility บนเครื่องนี้

## คำสั่งและผล

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B -m unittest discover -s 05_dataset_testing -p 'test_*.py' -v
py -3 -B scripts/check_repository.py
py -3 -B -m unittest discover -s scripts -p 'test_*.py' -v
```

| รายการ | ผล |
|---|---|
| Tests ของ 05 | 20 tests ผ่าน |
| Repository structure / links / synthetic contracts | ผ่าน |
| Regression tests ของ repository เดิม | 12 tests ผ่าน |
| CSV templates และ integration checklist | จำนวนคอลัมน์ถูกต้องทุกแถว |
| ขอบเขตไฟล์เปลี่ยนแปลง | เฉพาะ `05_dataset_testing/` |
| Commit / push / PR | ยังไม่ได้ทำ |

Tests ของ 05 ใช้ภาพสังเคราะห์ที่สร้างชั่วคราวใน test fixture และ human metadata สมมุติเพื่อทดสอบเครื่องมือเท่านั้น ไม่มีการสร้าง dataset จริงหรือแอบใช้ fixture เป็นหลักฐาน accuracy ภาพ/CSV/JSON ที่ tests สร้างถูกเก็บใน temporary directory และล้างเมื่อจบ

## สิ่งที่ tests ตรวจจริง

- ภาพเปิดได้และ hash ตรง, ไฟล์เสีย/หาย, path หลุด dataset root
- การรวมกลุ่มขวดหรือ session แบบเชื่อมต่อหลายทอด, hash ซ้ำ, derivatives และ source ที่หาไม่เจอ
- ภาพเดิมต่าง expected product นับเป็นหลาย cases แต่เป็นภาพเดียว; case ซ้ำถูกปฏิเสธ
- ค่า angle/enum/GT ที่ขัดกัน, missing_label ที่ไม่มีบันทึกหลักฐาน, reviewer ว่าง
- reference ที่ปน test, provenance hash ไม่ตรง, ภาพคล้ายต้องมีคนทวนพร้อม hash ผูกกับคู่ภาพ
- split proposal ทำซ้ำด้วย seed เดิมและไม่แยกกลุ่ม; ข้อมูลที่ lock แล้วไม่เสนอ split ใหม่
- CSV/JSON ผิดโครงสร้างและการปฏิเสธเขียนทับ output เดิม
- confusion matrix และสูตร metric จากคำตอบที่กำหนดเอง, operational errors, ตัวหารศูนย์, median/p95 และ sample count
- ผล prediction ไม่ครบ/ซ้ำ/ผิด mode/ผิดเวลา และ manifest เปลี่ยนหลังล็อก run
- คำสั่ง CLI ของ audit และ evaluation รวม exit code และ report ที่อ่านกลับได้

## ข้อจำกัดและงานที่ยังต้องทำกับข้อมูลจริง

ยังไม่ได้เลือกขวดจริง/ตกลง tolerance กับ 03, ถ่ายภาพและให้คนตรวจ, validate required-view profile, ส่ง development/reference, ทดลอง final test หรือวัดเวลา detector จริง ไม่มี metric accuracy จากภาพจริงในรายงานนี้

ทั้ง 26 กรณีใน integration checklist ยังเป็น `not_tested` เนื่องจากไม่มี implementation ของ API/UI/กล้อง/Storage ครบใน checkout นี้ ไม่สามารถสรุปว่าระบบผ่านจากการทดสอบเครื่องมือ 05

dHash เป็นตัวช่วยทวนภาพคล้าย อาจไม่จับภาพดัดแปลงทุกชนิด; provenance และการตรวจทานของมนุษย์ยังจำเป็น เครื่องมือตรวจบันทึก profile ของ missing_label ไม่ได้ตรวจ coverage จาก pixels แทน detector และการตั้ง config_locked/split_locked เป็นบันทึก workflow ไม่ใช่การบังคับสิทธิ์เข้าถึง final test
