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
    fail/<inspection_id>/...
    review/<inspection_id>/...
  pending/<inspection_id>/...
```

ภาพ JPG ต้นฉบับหมายถึงภาพที่เลือกตรวจหลังแก้ EXIF orientation
หากต้องรักษา bytes ที่ upload ทุก byte ให้เก็บ source เพิ่มแยกและระบุใน schema
วันที่โฟลเดอร์ใช้ Asia/Bangkok; created_at ใน metadata เป็น UTC

## ลำดับบันทึก

1. validate และสร้าง request/inspection id
2. บันทึก DB pending และเตรียมไฟล์ temp ภายใน root
3. เขียน original, annotated, result.json แล้ว rename แต่ละไฟล์
4. เมื่อครบให้ DB saved พร้อม relative file paths
5. ถ้าบางส่วนผิดพลาดให้ failed/pending และ error; retry ด้วย id เดิม
6. หลัง restart สแกน pending ให้สอดคล้อง DB; อย่าทำเหมือน transaction ข้ามไฟล์เป็น atomic

ผล PASS/FAIL/REVIEW ไม่เปลี่ยนตาม storage error
CSV สร้างจาก SQLite ตอน export แทน append พร้อมกันหลาย process
รีเซ็ตฉากไม่ลบ History หรือไฟล์; ลบจริงต้องเป็น action คนละอย่างที่ออกแบบภายหลัง

## สิ่งที่ UI แสดง

status saved/failed, ภาพ original/annotated ผ่าน URL lookup ตาม id,
reason/score/config_version, ปุ่ม retry เมื่อทำได้ และบอกถ้าต้องถ่ายใหม่
ไม่ใช้ browser file:// URL ไปยัง path ภายใน backend

## ข้อมูลสาธารณะ

Git ignore storage จริงทั้งหมด; track README นี้เท่านั้น
สำรองข้อมูลนอก repo ตามที่ทีมตกลงและกำหนดระยะเก็บตามพื้นที่เครื่อง
ยังไม่มี retention job/การลบอัตโนมัติใน scaffold นี้
