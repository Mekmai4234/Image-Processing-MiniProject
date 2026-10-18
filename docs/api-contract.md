# API contract v0.1 (แผนให้ทีม implement)

ยังไม่มี routes ใน scaffold; เอกสารนี้เป็นข้อตกลงไม่ใช่คำยืนยันว่า endpoint รันแล้ว
JSON ใช้ snake_case; product_id ชั่วคราว bottle_a/bottle_b; source_mode = simulation/webcam
result = PASS/FAIL/REVIEW; storage_status = pending/saved/failed

## Endpoints

| Method / path | ข้อมูลเข้า | ผลลัพธ์ |
|---|---|---|
| GET /api/health | — | service status/config version |
| GET /api/products | — | catalog ที่รองรับและชื่อแสดง |
| POST /api/locate-label | multipart image, expected_product | usable_view, bbox, quality, reason; ยังไม่สร้าง history |
| POST /api/inspections | multipart image, expected_product, source_mode, client_request_id, angle_deg optional | InspectionResult และ image URLs |
| GET /api/inspections | page, page_size, source_mode, result, product_id, date_from, date_to | items,total,page,page_size |
| GET /api/inspections/{id} | id | detail และสถานะไฟล์ |
| GET /api/inspections/{id}/images/{kind} | original หรือ annotated | image bytes |
| POST /api/inspections/{id}/retry-save | id เดิม | storage status; ถ้า source หายแจ้งถ่ายใหม่ |
| GET /api/exports/inspections.csv | filters เดียวกับ history | CSV ของข้อมูลจริง |
| PATCH /api/inspections/{id}/review | reviewed_result, reviewed_reason, reviewer | ผลตรวจทานแยก prediction เดิม |

GET export ต้องมี route ที่ไม่ชน dynamic inspection id; pagination และ max size ตรวจฝั่ง server
ไม่รับ arbitrary filesystem path จาก client; ใช้ id lookup กับ path ที่ backend จัดการ

## InspectionResult

ดูตัวอย่าง [PASS](../examples/inspection-pass.json), [FAIL](../examples/inspection-fail.json),
[REVIEW](../examples/inspection-review.json)

- inspection_id: UUID ของรอบตรวจ คงเดิมเมื่อ retry
- client_request_id: UUID ที่ client สร้าง; ซ้ำ payload เดิมคืนรายการเดิม
- created_at: UTC ISO-8601; หน้าเว็บแสดงเวลาไทย
- expected_product, detected_product: รหัสสินค้า; detected อาจเป็น null
- result, reason: คำตัดสินและเหตุผลตามกติกา
- match_score: number 0..1 หรือ null; ไม่ใช่ calibrated confidence
- score_method: template_ccoeff_normed หรือ null; method นี้สูงดีกว่า
- bbox, expected_bbox: {x,y,width,height} หรือ null หน่วย pixel ของภาพที่ใช้ตรวจจริง
- image_width/image_height: หลังแก้ EXIF orientation ก่อนตรวจและบันทึก original
- orientation_deg: มุมที่รู้จริงหรือ null; ไม่เดามุม Webcam หากไม่สามารถวัดได้
- timing_ms: orientation, inspection, storage, total ที่วัดจริงและแยก simulation time
- config_version: รุ่น template/threshold/catalog ที่ใช้ตรวจ
- storage_status: ไม่เปลี่ยนผลสินค้าเพราะเขียนไฟล์ไม่สำเร็จ
- images: URL original/annotated หรือ null เมื่อยังไม่มี
- reviewed_result, reviewer: null จนมีคนตรวจทาน

## Reasons และลำดับตัดสิน

good, wrong_label, misplaced_label, missing_label, blurred_image,
label_not_visible, unknown_product, ambiguous_match, orientation_failed
เริ่ม quality gate ก่อน identity/position; มีหลายข้อให้เก็บ checks เพิ่มโดยไม่ทับ reason หลัก
missing label ไม่สร้าง bbox ที่อ้างว่าพบ ใช้ expected_bbox เส้นประเท่านั้น

## Operational errors

400/422 invalid image/input/product, 413 too large, 409 idempotency conflict,
503 inspection unavailable; error body = {error:{code,message,request_id}}
ข้อผิดพลาด API ไม่ใช้ result=FAIL; UI แสดง ERROR/ลองใหม่
save failure หลังตรวจสำเร็จคืนผลตรวจพร้อม storage_status=failed และ error แยก

## Image coordinates

เก็บ bbox ตาม original ที่บันทึกแล้ว ไม่ใช่ canvas preview ที่ resize
UI transform scale+offset ตาม object-fit; mirror preview กับ overlay ต้องตรงแกน
รูป photo cutout สำหรับฉากเป็น visual asset ไม่ใช้แทน original ในตัวตรวจ

การแก้ contract ต้องแก้ examples + consumer 01/02/04 + tests พร้อมกันผ่าน PR
