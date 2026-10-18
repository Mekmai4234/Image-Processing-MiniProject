# เก็บภาพจริงและ Log บนเครื่อง

## ตำแหน่ง

ตั้ง STORAGE_ROOT ใน .env; resolve เทียบ repository root แล้วใช้ absolute path ภายใน service
ค่าเริ่ม ./storage; เปลี่ยนเป็น D:/VendingVisionData ได้หากมีพื้นที่และเขียนได้
ข้อมูลถูกเขียนบนเครื่องที่รัน Backend เท่านั้น ไม่ใช่เครื่องของผู้เปิดเว็บเสมอไป

```text
storage/
  inspections.sqlite3
  2026-10-18/
    pass/<inspection_id>/original.jpg
                         annotated.jpg
                         result.json
                         supporting/0.jpg
                         supporting/1.jpg
    fail/<inspection_id>/...
    review/<inspection_id>/...
  pending/<inspection_id>/...
```

ภาพ JPG ต้นฉบับหมายถึงภาพที่เลือกตรวจหลังแก้ EXIF orientation
หากต้องรักษา bytes ที่ upload ทุก byte ให้เก็บ source เพิ่มแยกและระบุใน schema
วันที่โฟลเดอร์ใช้ Asia/Bangkok; created_at ใน metadata เป็น UTC
supporting/ เก็บทุกภาพเพิ่มเติมที่ Backend ใช้ตัดสิน โดย index ตรง request และ evidence ในผล
ทุก supporting_images ที่รับเข้ารอบตรวจเป็นหลักฐานของรอบนั้น ต้องเก็บตามลำดับทั้งหมด
ภาพเหล่านี้เป็นส่วนหนึ่งของหลักฐานที่ต้องเก็บ ไม่ขึ้นกับ SAVE_ROTATION_FRAMES
ตัวเลือก SAVE_ROTATION_FRAMES ใช้กับภาพหมุนระหว่างทางที่ไม่ได้ส่งเป็นหลักฐานตัดสินเท่านั้น

## คำตัดสินและสถานะล่าสุด

result.json เป็น decision snapshot ที่ไม่แก้หลังสร้าง ประกอบด้วย inspection_id,
client_request_id, created_at, source_mode, expected_product/detected_product, result/reason,
match_score/score_method, bbox/ขนาดภาพ, orientation_deg, config_version และ evidence ที่ใช้ตัดสิน
บันทึกชนิด snapshot และ schema_version ให้ชัด; ไม่ใส่ storage_status หรือข้อมูล human review
รวม relative paths ของภาพที่เกี่ยวข้องได้ แต่ไม่เก็บ absolute path ที่ขึ้นกับเครื่อง
timing ใน snapshot เก็บเฉพาะค่าที่วัดเสร็จแล้วก่อน persistence; ไม่แต่ง storage/total ล่วงหน้า

SQLite เก็บ snapshot/index พร้อม storage_status, storage error, เวลาบันทึก,
reviewed_result, reviewed_reason, reviewer, reviewed_at และ timing_ms ของการทำงานจริง
API GET ประกอบ InspectionResult จากคำตัดสินเดิมและข้อมูล SQLite ล่าสุด แล้วสร้าง image URLs
human review เปลี่ยนเฉพาะ reviewed_* ไม่แก้ result/reason เดิมหรือย้ายโฟลเดอร์ตามคำตอบคนตรวจ
retry-save ไม่คำนวณภาพใหม่และไม่แก้ result.json; ถ้าต้องตรวจใหม่ให้สร้าง inspection_id ใหม่
หากต้องส่งออกผลล่าสุดให้ใช้ API/CSV แทนการอ่าน result.json เป็นสถานะปัจจุบัน

## ลำดับบันทึก

1. validate และสร้าง request/inspection id
2. บันทึก DB pending และเตรียมไฟล์ temp ภายใน root
3. เขียน original, annotated, supporting images ที่ใช้ตัดสิน และ decision snapshot ลง temp แล้ว rename แต่ละไฟล์
4. เมื่อไฟล์หลักฐานที่จำเป็นครบให้ DB saved พร้อม relative file paths; ยังไม่ครบห้ามรายงาน saved
5. ถ้าบางส่วนผิดพลาดให้ failed/pending และ error; retry ด้วย id เดิม
6. หลัง restart สแกน pending/failed เทียบ DB และไฟล์ที่จำเป็น; อย่าทำเหมือน transaction ข้ามไฟล์เป็น atomic

ใส่ unique constraint ให้ client_request_id; คำขอซ้ำพร้อมกันต้องได้ inspection เดียว
retry-save อ่านหลักฐานเดิมที่เก็บพักไว้ หากขาด source ให้ตอบว่า retry ไม่ได้และต้องถ่ายใหม่
snapshot กับไฟล์อาจเสร็จก่อน DB เปลี่ยน saved; recovery ตรวจความครบและ id ก่อนปรับสถานะ
ถ้า DB/idempotency reserve ใช้ไม่ได้จนรับรอบตรวจที่กู้คืนได้ไม่ได้ ให้คืน 503 ไม่อ้างว่าบันทึก History แล้ว

ผล PASS/FAIL/REVIEW ไม่เปลี่ยนตาม storage error
CSV สร้างจาก SQLite ตอน export แทน append พร้อมกันหลาย process
รีเซ็ตฉากไม่ลบ History หรือไฟล์; ลบจริงต้องเป็น action คนละอย่างที่ออกแบบภายหลัง

## สิ่งที่ UI แสดง

status saved/failed, ภาพ original/annotated ผ่าน URL lookup ตาม id,
reason/score/config_version, ปุ่ม retry เมื่อทำได้ และบอกถ้าต้องถ่ายใหม่
ภาพหลักฐานใช้ /api/inspections/{id}/images/supporting/{index}; server ตรวจ id/index และขอบเขต root
storage_error เป็น null หรือ {code,message,retryable}; UI ใช้ retryable แสดงปุ่ม retry ที่ทำได้จริง
ถ้าภาพ supporting บางใบยังไม่ถูกบันทึก ให้ URL ตำแหน่งนั้นเป็น null โดยคงจำนวน/index เดิม
ไม่ใช้ browser file:// URL ไปยัง path ภายใน backend

## ข้อมูลสาธารณะ

Git ignore storage จริงทั้งหมด; track README นี้เท่านั้น
สำรองข้อมูลนอก repo ตามที่ทีมตกลงและกำหนดระยะเก็บตามพื้นที่เครื่อง
ยังไม่มี retention job/การลบอัตโนมัติใน scaffold นี้
