# API contract v0.2 (แผนให้ทีม implement)

ยังไม่มี routes ใน scaffold; เอกสารนี้เป็นข้อตกลงไม่ใช่คำยืนยันว่า endpoint รันแล้ว
JSON ใช้ snake_case; product_id ชั่วคราว bottle_a/bottle_b; source_mode = simulation/webcam
result = PASS/FAIL/REVIEW; storage_status = pending/saved/failed

## Endpoints

| Method / path | ข้อมูลเข้า | ผลลัพธ์ |
|---|---|---|
| GET /api/health | — | service status/config version |
| GET /api/products | — | catalog ที่รองรับ/ชื่อแสดง และ simulation_defaults |
| POST /api/locate-label | multipart image, expected_product | usable_view, bbox, quality, reason; ยังไม่สร้าง history |
| POST /api/bottle-shape | multipart image | schema_version, status, radial_profile, quality; ไม่คืน mask และไม่สร้าง history |
| POST /api/inspections | multipart ตามหัวข้อคำขอตรวจด้านล่าง | InspectionResult และ image URLs |
| GET /api/inspections | page, page_size, source_mode, result, product_id, date_from, date_to, q, sort_by, sort_order | items,total,page,page_size |
| GET /api/inspections/{id} | id | detail และสถานะไฟล์ |
| GET /api/inspections/{id}/files | id | metadata รายการไฟล์บนดิสก์และสถานะความสมบูรณ์ |
| GET /api/inspections/{id}/download | id | ZIP bundle ของไฟล์ตรวจทั้งหมด (ปฏิเสธ 409 files_incomplete หากไฟล์ไม่ครบ) |
| GET /api/inspections/{id}/result.json | id | immutable decision snapshot ตรงๆ |
| GET /api/inspections/{id}/images/{kind} | original หรือ annotated | image bytes |
| GET /api/inspections/{id}/images/supporting/{index} | index เริ่ม 0 ของภาพหลักฐานที่เก็บ | image bytes |
| POST /api/inspections/{id}/retry-save | id เดิม | storage status; ถ้า source หายแจ้งถ่ายใหม่ |
| GET /api/exports/inspections.csv | filters เดียวกับ history (รวม q, sort_by, sort_order) | CSV ของข้อมูลจริง |
| PATCH /api/inspections/{id}/review | reviewed_result, reviewed_reason, reviewer | ผลตรวจทานแยก prediction เดิม |

GET export ต้องมี route ที่ไม่ชน dynamic inspection id; pagination และ max size ตรวจฝั่ง server
ไม่รับ arbitrary filesystem path จาก client; ใช้ id lookup กับ path ที่ backend จัดการ
GET /api/products เพิ่ม simulation_defaults={max_rotation_deg,rotation_step_deg}
จาก env ที่ Backend validate แล้ว เพื่อให้ 02 ใช้ค่าเริ่มต้นร่วมกัน โดยไม่เผย backend paths
ชนิด/ค่าเริ่มต้นและที่มาของ config อยู่ใน [configuration](configuration.md)

## คำขอตรวจและหลักฐานหลายมุม

`POST /api/inspections` รับ multipart fields ดังนี้:

| Field | ชนิด / ข้อกำหนด |
|---|---|
| image | ภาพหลักที่เลือกใช้แสดงผล จำเป็นทุกครั้ง รวมถึงรอบที่หาฉลากไม่พบ |
| expected_product | product_id ที่อยู่ใน catalog |
| source_mode | simulation หรือ webcam |
| client_request_id | UUID ใหม่ต่อรอบตรวจ; retry รอบเดิมใช้ค่าเดิม |
| angle_deg | มุมภาพหลัก 0 ถึงน้อยกว่า 360 หรือไม่ส่งเมื่อไม่ทราบ |
| supporting_images | ภาพหลักฐานเพิ่มเติม ส่ง field ชื่อนี้ซ้ำตามลำดับ; ไม่จำเป็นใน single_view |
| evidence | JSON string ตามข้อตกลงด้านล่าง; ถ้าไม่ส่งให้ใช้ single_view/not_requested |

ตัวอย่าง evidence ของภาพหลัก 0° พร้อมภาพเพิ่มเติม 90°, 180°, 270°:

```json
{
  "kind": "multi_view",
  "search_status": "exhausted",
  "supporting_angles_deg": [90, 180, 270],
  "reported_coverage_deg": 360
}
```

- kind: single_view / multi_view
- search_status: not_requested / usable_view_found / exhausted / timed_out
- supporting_angles_deg: array ที่ยาวเท่าจำนวน supporting_images แต่ละค่าเป็นมุม 0..<360 หรือ null หากไม่ทราบ
- reported_coverage_deg: number 0..360 หรือ null เป็นข้อมูลรายงานจาก client ไม่ใช่หลักฐานยืนยันว่าครบด้าน
- single_view ต้องไม่มี supporting_images และใช้ supporting_angles_deg=[]
- ใน v0.2 single_view มี verified_coverage=false เสมอ; การยืนยันครอบคลุมด้านที่ต้องตรวจต้องใช้ multi_view และ profile ที่ validate
- multi_view ต้องมี supporting_images อย่างน้อย 1 ภาพ และทั้งหมดต้องเป็นขวดเดียวกันกับภาพหลัก

Backend ตรวจชนิดไฟล์ จำนวนภาพ ขนาดต่อภาพ/รวม และจำนวน pixels ก่อนประมวลผล
ใช้ MAX_UPLOAD_MB, MAX_IMAGE_PIXELS, MAX_INSPECTION_VIEWS และ MAX_REQUEST_MB ตาม [configuration](configuration.md)
locator ใช้ขีดจำกัดไฟล์/ภาพ/HTTP body เช่นเดียวกัน; limit เกินตอบ 413 ไม่สร้างผลสินค้า
การส่งมุมครบหรือ reported_coverage_deg=360 ไม่ทำให้ missing_label เป็น FAIL โดยอัตโนมัติ
คนที่ 03/05 ต้องกำหนด required-view profile ต่อสินค้าและ validate วิธีตรวจหลักฐานก่อนใช้งานจริง
Backend ต้องเห็นพื้นที่ที่ profile กำหนด ภาพคมชัดพอ และยืนยันการไม่มีฉลากได้จาก pixels
หากยังไม่มี profile ที่ validate หรือหลักฐานไม่พอให้ REVIEW; ห้ามเชื่อ flag จาก client แทนการตรวจ

เมื่อ ORIENT จบแบบ exhausted/timed_out ต้องส่งภาพหลักที่เลือกได้พร้อมหลักฐานเข้า endpoint นี้เช่นกัน
Backend จึงสร้างผล REVIEW/orientation_failed และ History ได้; frontend ไม่สร้างผลตรวจสินค้าเอง
หากมีหลักฐานที่เพียงพออยู่แล้ว Backend ตัดสินจากหลักฐานนั้น ไม่ให้สถานะการค้นหาทับผลจริง
ค่า search_status ไม่ใช้แทน reason ของภาพ: ภาพเดียวที่เบลอยังเป็น REVIEW/blurred_image

payload เดิมหมายถึงภาพหลัก/ภาพเพิ่มเติมและลำดับ, expected_product, source_mode,
angle_deg และ evidence เดียวกัน; client_request_id เดิมแต่ payload ต่างให้ 409
Backend ผูก config_version กับรอบตรวจครั้งแรก; retry ไม่ตรวจใหม่ด้วย config รุ่นอื่น

## ผลจาก locator (ยังไม่ใช่ผลตรวจสินค้า)

`POST /api/locate-label` คืน JSON รูปแบบเดียวกันทั้ง 02 และ 04:

```json
{
  "usable_view": true,
  "bbox": {"x": 120, "y": 180, "width": 160, "height": 100},
  "image_width": 400,
  "image_height": 500,
  "quality": {"sharp_enough": true, "label_visible": true, "bottle_visible": true},
  "reason": "usable_view"
}
```

quality เป็น boolean ทั้ง 3 ค่า; usable_view=true เมื่อฉลากชัดและเห็นบริเวณขวดพอตรวจตำแหน่ง
หากเห็นแค่ฉลากที่ถูก crop จนไม่เห็นขวด ให้ usable_view=false และ reason=orientation_failed
reason ของ locator ใช้ usable_view / blurred_image / label_not_visible / orientation_failed
ไม่พบ candidate ให้ bbox=null; bbox ใช้พิกัดภาพหลังแก้ EXIF เหมือน inspection
ฉลากผิดชนิดที่เห็นชัดยังเป็น usable_view=true เพื่อให้ตัวตรวจตัดสิน wrong_label ได้
locator ไม่ตรวจผ่าน/ตก ไม่สร้าง History และไม่คืนคะแนนที่อ้างเป็น confidence

## InspectionResult

ดูตัวอย่าง [PASS](../examples/inspection-pass.json), [FAIL](../examples/inspection-fail.json),
[REVIEW](../examples/inspection-review.json) และ [REVIEW หลังค้นหาหลายมุม](../examples/inspection-orientation-review.json)

- inspection_id: UUID ของรอบตรวจ คงเดิมเมื่อ retry
- client_request_id: UUID ที่ client สร้าง; ซ้ำ payload เดิมคืนรายการเดิม
- created_at: UTC ISO-8601; หน้าเว็บแสดงเวลาไทย
- source_mode: simulation หรือ webcam
- expected_product, detected_product: รหัสสินค้า; detected อาจเป็น null
- result, reason: คำตัดสินและเหตุผลตามกติกา
- match_score: number 0..1 หรือ null; ไม่ใช่ calibrated confidence
- score_method: template_ccoeff_normed_clamped_v1 หรือ null; method นี้สูงดีกว่า
- bbox, expected_bbox: {x,y,width,height} หรือ null หน่วย pixel ของภาพที่ใช้ตรวจจริง
- image_width/image_height: หลังแก้ EXIF orientation ก่อนตรวจและบันทึก original
- orientation_deg: มุมที่รู้จริงหรือ null; ไม่เดามุม Webcam หากไม่สามารถวัดได้
- timing_ms: orientation, inspection, storage, total ที่วัดจริงและแยก simulation time
- config_version: รุ่น template/threshold/catalog ที่ใช้ตรวจ
- storage_status: ไม่เปลี่ยนผลสินค้าเพราะเขียนไฟล์ไม่สำเร็จ
- storage_error: null หรือ {code,message,retryable}; retryable เป็น boolean และใช้แจ้งว่ากู้การบันทึกรอบเดิมได้หรือไม่
- images: URL original/annotated หรือ null เมื่อยังไม่มี
- evidence: ข้อมูล kind/search_status/มุม/coverage ที่ส่งมา พร้อม verified_coverage (boolean),
  required_view_profile (ชื่อและรุ่น profile หรือ null), supporting_images (array ของ API URL หรือ null ตาม index)
  verified_coverage=true ได้เฉพาะเมื่อ Backend ตรวจผ่าน profile จริง; ค่าเริ่ม false
- reviewed_result, reviewed_reason, reviewer, reviewed_at: null จนมีคนตรวจทาน

ทุก example เป็นข้อมูลสังเคราะห์และมี demo=true; id ยังคงใช้รูปแบบ UUID เหมือนระบบจริง
ชื่อสินค้าที่ระบบตรวจพบใช้ detected_product; label_product ใช้เฉพาะ ground truth ใน dataset
angle_deg ในคำขอถูกส่งคืนเป็น orientation_deg ของภาพหลัก ไม่อ้างว่าเป็นมุมที่วัดได้เองจาก Webcam

timing_ms.orientation คือเวลาที่ Backend ประเมินหลักฐานมุมในคำขอตรวจนี้ (0 เมื่อไม่ทำ)
inspection คือขั้นตรวจภาพหลัก, storage คือการบันทึกครั้งล่าสุด, total คือผลรวมเวลางานของรอบนั้น
เวลา locator ก่อนหน้า/ผู้ใช้หมุนมือ/การรอ network ให้ frontend วัดแยก ไม่ใส่ปนเป็นเวลาอัลกอริทึม
retry-save อัปเดตเฉพาะช่วง storage/total ใน DB; ค่าการตรวจภาพเดิมไม่ถูกวัดใหม่หรือแก้ย้อนหลัง
single_view ค่าเริ่ม evidence คือ kind=single_view, search_status=not_requested,
supporting_angles_deg=[], reported_coverage_deg=null, verified_coverage=false,
required_view_profile=null, supporting_images=[]
supporting_images ใน response ต้องยาวเท่ามุมที่ส่งมา; ภาพที่ยังเขียนไม่สำเร็จใช้ null ณ index เดิม
ห้ามตัดสมาชิก null ออกจน URL กับมุมจับคู่ผิด; saved ได้เมื่อภาพหลัก/annotated/ภาพหลักฐานครบทั้งหมด

## ความหมายคะแนน

template_ccoeff_normed_clamped_v1 รับ raw score ที่เป็น finite number ในช่วง [-1,1]
แล้วคำนวณ match_score=max(0,raw_score); แสดงเปอร์เซ็นต์ได้โดยคูณ 100 พร้อมป้าย similarity
ดูนิยาม raw method ใน [OpenCV TemplateMatchModes](https://docs.opencv.org/4.x/df/dfb/group__imgproc__object.html)
การ clamp เป็นข้อตกลงของโปรเจกต์นี้เพิ่มเติมจากค่า raw ของ OpenCV
template/ภาพที่ไม่มี variance หรือ raw score ไม่ finite ให้ score=null และ REVIEW/ambiguous_match
ห้าม clamp ค่าผิดปกติเพื่อทำให้ดูเหมือนผลที่เชื่อถือได้; บันทึกวิธีและ config_version ให้ตรวจย้อนหลังได้
คะแนนสูงของ detected_product ที่ต่างจาก expected_product ยังคงเป็น FAIL/wrong_label

## Reasons และลำดับตัดสิน

| result | reason ที่ใช้ได้ |
|---|---|
| PASS | good |
| FAIL | wrong_label, misplaced_label, missing_label |
| REVIEW | blurred_image, label_not_visible, unknown_product, ambiguous_match, orientation_failed |

เริ่ม quality gate ก่อน identity/position; มีหลายข้อให้เก็บรายละเอียดเพิ่มโดยไม่ทับ reason หลัก
ใช้ชื่อข้างต้นทุกส่วน ไม่ใช้ alias no_label, unknown_label หรือ wrong_product ในผล API
missing label ไม่สร้าง bbox ที่อ้างว่าพบ ใช้ expected_bbox เส้นประเท่านั้น

## Operational errors

400/422 invalid image/input/product, 413 too large, 409 idempotency conflict,
503 inspection unavailable; error body = {error:{code,message,request_id}}
ข้อผิดพลาด API ไม่ใช้ result=FAIL; UI แสดง ERROR/ลองใหม่
save failure หลังตรวจสำเร็จคืนผลตรวจพร้อม storage_status=failed และ error แยก
storage_status=failed ต้องมี storage_error; เมื่อบันทึกสำเร็จให้ storage_error=null
ใช้ storage_error ตาม shape ข้างต้น; ถ้ายังจอง idempotency/DB record ที่กู้คืนได้ไม่สำเร็จให้ตอบ 503
กรณี 503 นี้ไม่อ้างว่ามี inspection ที่บันทึกอย่างถาวรหรือ History พร้อมใช้งาน
result.json เก็บคำตัดสิน ณ เวลาตรวจแบบ immutable; SQLite เก็บ storage/review ที่เปลี่ยนได้
GET รวมผลตรวจเดิมกับสถานะล่าสุดตาม [storage guide](storage-guide.md); retry-save ไม่สร้างคำตัดสินใหม่

## Image coordinates

เก็บ bbox ตาม original ที่บันทึกแล้ว ไม่ใช่ canvas preview ที่ resize
UI transform scale+offset ตาม object-fit; mirror preview กับ overlay ต้องตรงแกน
รูป photo cutout สำหรับฉากเป็น visual asset ไม่ใช้แทน original ในตัวตรวจ

การแก้ contract ต้องแก้ examples + consumer 01/02/04 + tests พร้อมกันผ่าน PR

## History / Export และ Files ที่ต้องใช้กติกาเดียวกัน

page เริ่ม 1, page_size ค่าเริ่ม 20 และสูงสุด 100; product_id ใน filter หมายถึง expected_product
date_from/date_to เป็น YYYY-MM-DD ตาม APP_TIMEZONE รวมทั้งวันต้นและวันปลาย
Backend แปลงเป็นช่วง UTC ตั้งแต่ต้นวันแรกจนก่อนต้นวันถัดจากวันสุดท้าย; ปฏิเสธช่วงวันกลับด้าน
ค้นหาด้วย q: ค้นหาคำค้นหา (case-insensitive) ใน inspection_id, client_request_id, expected_product, detected_product, reason
เรียงลำดับด้วย sort_by: รองรับ created_at, expected_product, result, match_score (ค่าเริ่มต้น created_at)
ทิศทางการเรียงด้วย sort_order: asc หรือ desc (ค่าเริ่มต้น desc แล้ว tie-break ด้วย inspection_id)
CSV ใช้ filters เดียวกัน (รวม q, sort_by, sort_order) แต่ส่งออกทุกแถวที่ตรง ไม่ตัดตาม page ของ History
id หรือภาพที่ไม่มีคืน 404; retry ที่ไม่มี source กู้คืนได้คืน error code source_unavailable
พร้อมสถานะเดิม failed และ retryable=false เพื่อให้ UI แนะนำถ่ายใหม่

`GET /api/inspections/{id}/files`: ตรวจสอบสถานะไฟล์จริงบนดิสก์ คืน all_available=true และ download_zip_url เมื่อไฟล์จำเป็นทั้งหมด (original, annotated, result.json, และ supporting images ตาม evidence) มีอยู่จริงและขนาด > 0 bytes
`GET /api/inspections/{id}/download`: บันทึกเป็น ZIP archive ของไฟล์ทั้งหมด หากไฟล์ใดขาดหายหรือมีขนาด 0 bytes จะไม่สร้าง partial zip และตอบกลับด้วย 409 files_incomplete ทันที
`GET /api/inspections/{id}/result.json`: คืน snapshot ผลการตรวจแบบ immutable โดยตรง

## รูปทรงขวดและ Radial Profile (bottle-silhouette-v1)

`POST /api/bottle-shape` สำหรับส่งภาพหลักภาพเดียวเพื่อวิเคราะห์รูปทรงขวดและ radial profile สำหรับนำไปขึ้นรูปจำลอง 3D ของสมาชิก 02
(ทำงานบนหน่วยความจำ ไม่บันทึกลง Database หรือ Disk และไม่ส่งผลต่อผลตัดสิน PASS/FAIL ของฉลาก)

- **Input**: Multipart `image` (JPEG/PNG) ขนาดสูงสุดและข้อกำหนดเดียวกับ `POST /api/locate-label`
- **Output**: JSON Schema ตาม interface `bottle-silhouette-v1`:
  - `schema_version`: `"bottle-silhouette-v1"`
  - `status`: `"ready"` หรือ `"fallback"`
  - `reason`: ข้อความระบุผล เช่น `"usable_silhouette"`, `"bottle_not_isolated"`, `"truncated_or_not_upright"`, `"asymmetric_silhouette"`
  - `image_width` / `image_height`: ขนาดภาพหลักหลังทำ EXIF normalization
  - `bbox`: พิกัด pixel bounding box ของขวด `{x, y, width, height}` หรือ `null` เมื่อ fallback
  - `normalized_width` / `normalized_height`: สัดส่วนเทียบกับขนาดภาพ
  - `aspect_ratio`: `bbox.width / bbox.height`
  - `contour`: รายการพิกัดเส้นรอบรูปขวด `[[x, y], ...]`
  - `radial_profile`: ตัวอย่างรัศมี 32 จุด (เรียงจากบน `y_fraction=0.0` ไปล่าง `y_fraction=1.0`) โดย `radius_over_height = ครึ่งความกว้างแถว / bbox.height`
  - `quality`: `{whole_bottle_visible, center_drift, axisymmetric_assumption}`
  - **หมายเหตุ**: API จะ**ไม่ส่ง** mask ก้อนใหญ่กลับมาทาง JSON เพื่อความรวดเร็วและประหยัด bandwidth
- **การแปลงพิกัดสู่ 3D World Units (สำหรับ 02)**:
  ```text
  world_y = (1 - y_fraction) * H
  world_radius = radius_over_height * H
  ```
- **Fallback**: หากไม่พบขวด, พื้นหลังไม่เรียบ, ภาพตัดขวด หรือขวดเอียงเกินเกณฑ์ จะคืน `status: "fallback"` และให้หน้าเว็บ 02 ใช้ทรงกระบอก generic แทน
- **ตัวอย่างผลลัพธ์**:
  - ตัวอย่างสำเร็จ: [examples/bottle-shape-ready.json](../examples/bottle-shape-ready.json)
  - ตัวอย่าง fallback: [examples/bottle-shape-fallback.json](../examples/bottle-shape-fallback.json)

