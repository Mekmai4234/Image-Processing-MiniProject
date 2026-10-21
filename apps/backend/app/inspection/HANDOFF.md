# งานต่อจาก Review PR #10 — ข้อเสนอส่งต่อจาก 03 ให้ 04/05

จัดทำ 19 ตุลาคม 2026 จาก review ของ commit ee7e817
สถานะ: เตรียมและทดสอบฝั่ง 03 แล้ว ยังไม่ได้ยืนยันแทนผู้รับผิดชอบ 04/05
เอกสารนี้ไม่ใช่การประกาศว่า HTTP adapter, CI รวม หรือ real-data validation เสร็จแล้ว

## อัปเดต 21 ตุลาคม 2026 — ขอบเขตตามที่ผู้ใช้ยืนยัน

รอบนี้คงขอบเขตเฉพาะ 03 ไม่แก้ services/inspection_adapter.py หรือ routes ของ 04
ฐาน develop 9fb8fd7 มี HTTP inspection เรียก 03 แล้ว แต่ HTTP locator ยังเป็น heuristic
อีกชุด และ stored annotation ยังไม่รับ score ข้อบกพร่องสองจุดนี้จึงยังรอ 04 ต่อจริง

พร้อมส่งต่อแล้ว:

- [build_detector_config และ schema/provenance/validation binding](CONFIGURATION.md)
- [analyze_shape และ interface ให้ 02](SHAPE.md) แยกจาก InspectionResult
- `annotate_fields(...)` รับ result/reason/bbox/expected_bbox/match_score จริง แล้วคืน RGB copy
- HTTP integration tests ผ่าน routes/DB/storage จริงใน temporary directory ด้วย detector
  03 จริง ไม่ได้ mock run_detector_03 หรือแทนที่ HTTP locator ของ 04 ให้ดูเหมือนแก้แล้ว

จุดที่ 04 ต้องนำไปใช้ภายหลัง:

```python
# ใน adapter ของ 04: config คือชุดเดียวกับที่ส่ง inspect_image
locator_payload = locate_label(cv_bgr, expected_product, config, color_order="BGR").to_dict()

# เพิ่ม match_score จาก inspect_output ในจุดเรียก annotation ของ HTTP route ก่อน encode/store
annotated_rgb = annotate_fields(
    cv_bgr, result=inspect_output["result"], reason=inspect_output["reason"],
    bbox=inspect_output.get("bbox"), expected_bbox=inspect_output.get("expected_bbox"),
    match_score=inspect_output.get("match_score"), color_order="BGR",
)
```

04 ต้องแก้จุดเรียกจริงทั้ง adapter และ route ที่ส่ง score แล้ว encode RGB → BGR/JPG
ไม่ใช้ global monkeypatch หรือ state ของคำขอก่อนหน้าเพื่อส่ง score ข้าม request
เมื่อ config ไม่พร้อม HTTP locator จริงควรคืน 503 หรือ readiness ที่ตกลงร่วมกัน
ไม่ fallback ใช้ heuristic ของ DEMO ในโหมดจริงโดยไม่บอกผู้ใช้

quality semantics ของ locator 03: sharp_enough วัดบน label candidate (หรือ bottle crop
เมื่อไม่มี candidate); bottle_visible หมายถึง silhouette ทั้งขวดผ่าน geometry gate
บนฉากเรียบ ไม่ใช่ semantic object recognition; label_visible หมายถึงพบ candidate
ไม่ใช่รู้ชนิดสินค้า; usable_view รวมฉลาก/คุณภาพ/บริเวณขวดที่พอประเมินตำแหน่ง
known wrong label ยัง usable; identity/product match ทราบหลัง inspect เท่านั้น
01/04 ใช้ false sharpness แนะนำถือนิ่ง, false label visibility แนะนำหมุน/ถ่ายใหม่ตาม reason
อย่าแสดง product match/position correct ล่วงหน้าจาก locator

ตารางเก่าด้านล่างเป็นข้อเสนอเริ่มต้น ข้อมูลอัปเดตนี้ให้ใช้ประกอบก่อนต่อระบบจริง

## 1. ฟังก์ชันที่ให้ 04 เรียก

```python
locate_label(image, expected_product, config, *, color_order) -> LocatorResult
inspect_image(image, expected_product, config, *, color_order,
              source_mode="simulation", angle_deg=None,
              supporting_images=(), evidence=None) -> Decision
annotate_image(image, decision, *, color_order) -> numpy.ndarray
```

04 decode/แก้ EXIF หนึ่งครั้งก่อนเรียก: image เป็น uint8 H×W×3 ของภาพหลักเต็มขนาด
ทุกภาพใช้ RGB/BGR ตาม color_order ที่ระบุ ส่วน templates เป็น RGB เสมอ
03 ไม่รับ HTTP Request, filename หรือ ground truth มาเป็น feature
ทั้งสองโหมดใช้ inspect_image เดียวกัน; Webcam ที่ไม่ทราบมุมใช้ angle_deg=None

`LocatorResult.to_dict()` เป็น locator payload ตาม contract อยู่แล้ว
`Decision.to_dict()` เป็นผลภายใน รวม diagnostics/evidence_assessment
เพิ่ม `Decision.to_inspection_fields()` สำหรับสำเนาเฉพาะ fields ของ 03 ที่ 04
นำไปประกอบ HTTP response ต่อได้ โดยไม่ต้องส่ง diagnostics ภายในให้ browser
method เดิมและ signature ของ detector ยังคงใช้ได้

## 2. Mapping ไป InspectionResult v0.2

| ข้อมูล API | แหล่งข้อมูล / เจ้าของ |
|---|---|
| result/reason | 03 คืนตามกฎ quality → identity → position |
| expected_product/detected_product | 03 คืนรหัส catalog ที่ตรวจจริง ไม่ใช้ label_product เป็น prediction |
| match_score/score_method | 03 คืน similarity/null ไม่เปลี่ยนเป็น probability |
| bbox/expected_bbox/image_width/image_height | 03 คืนพิกัดภาพหลักหลัง EXIF; ภาพเสริมไม่มีสิทธิ์แทน bbox ภาพหลัก |
| orientation_deg/source_mode/config_version | 03 คืนค่ารอบตรวจที่รับไว้และ config ของ Backend |
| timing_ms.orientation/inspection | เวลาจริงจาก 03 ในคำขอนี้ ไม่รวม locator request ก่อนหน้า/ผู้ใช้หมุนมือ/network |
| timing_ms.storage/total | 04 วัด persistence; total = orientation + inspection + storage |
| evidence | projection ของ 03 ตามตารางด้านล่าง แล้ว 04 เติม URL ตาม index |
| inspection_id/client_request_id/created_at | 04 จัดการ UUID/idempotency/เวลา UTC |
| images/storage_status/storage_error | 04 จัดเก็บและสร้าง URL ตาม id; storage failure ไม่เปลี่ยน result/reason |
| reviewed_result/reviewed_reason/reviewer/reviewed_at | 04 จัดการแยก prediction เดิม; ก่อน review เป็น null |

`to_inspection_fields()` เป็นข้อมูลบางส่วน ไม่ใช่ response ที่ส่งได้ทันที:
ไม่มี IDs, storage/review fields, image URLs และไม่มี storage/total timings ที่แต่งขึ้น
04 ต้องเติมครบก่อนส่งตาม contract

| evidence_assessment ภายใน | evidence สำหรับ API |
|---|---|
| kind/search_status/supporting_angles_deg/reported_coverage_deg | คัดลอกค่าจากรอบตรวจ |
| verified_coverage/required_view_profile | ผลประเมินฝั่ง Backend; baseline นี้ false/null เสมอ |
| supporting_indices | สร้าง supporting_images เป็น [null, ...] ครบจำนวนและลำดับเดิม |
| usable_supporting_indices/supporting_locator_results | ข้อมูลช่วยเลือกมุมภายใน ไม่เพิ่มเป็น field ใน contract v0.2 |

เมื่อเขียนภาพ index ใดสำเร็จ 04 เติม URL ณ index นั้น เมื่อยังไม่สำเร็จคง null
ห้ามกรอง null หรือสลับลำดับ และห้ามรายงาน saved จน original/annotated/หลักฐานครบ
projection คืนสำเนา: เติม URL/timing ใน dict ไม่แก้ Decision เดิม
decision snapshot กับสถานะ mutable ใน DB ยังคงแยกตาม storage contract

## 3. ข้อผิดพลาดและ config ฝั่ง Backend

ข้อเสนอ mapping สำหรับ 04 (ยังไม่ใช่ implementation ของ HTTP routes):

- Decode/EXIF/MIME/body/file/view/pixel limit ตรวจที่ adapter ก่อนเรียก 03
  เกินขนาดตอบ 413; ไฟล์เสียตอบ 400/422 ตาม contract
- InspectionInputError ใช้ 422 สำหรับ fallback ของ pixels/product/metadata ที่ไม่ถูกต้อง
  ไม่จับข้อความ exception เพื่อเดาประเภท 413; adapter ตรวจ limit โดยตรงก่อนเรียก
- InspectionConfigError เป็น service/config error: ไม่เปิดรับงานหาก config startup ผิด
  หรือคืน 503 inspection_unavailable เมื่อพร้อมใช้งานไม่ได้ ไม่เปลี่ยนเป็น FAIL ของขวด
- เมื่อ error ก่อนมีคำตัดสินสำเร็จ ไม่สร้าง product result/History ที่อ้างว่าตรวจแล้ว
  DB/idempotency/storage error ของ 04 จัดการตาม contract แยกจาก errors ของ 03

04 โหลด catalog/templates/thresholds/config_version/validated/validation_reference
จากแหล่งที่ Backend ควบคุม ไม่ใช้ **config หรือ validated/profile จาก client**
ให้ client เลือกได้เพียง expected_product ใน catalog และ metadata ที่ contract อนุญาต
ทวน config ตอน startup; 03 ตรวจความถูกต้องซ้ำเมื่อเรียก แต่ไม่ได้ตรวจว่ารายงานจริง
มีอยู่เพียงเพราะ validation_reference เป็นข้อความที่ไม่ว่าง

ห้าม import synthetic_config, bottle_image หรือ label_image จาก tests ไปเป็น config ของแอป
fixtures ใช้ทดสอบ branch PASS/FAIL เท่านั้น ไม่ได้ผ่าน validation ขวดจริง

## 4. จุดเชื่อมกับข้อมูล 05

| Field | ความหมายและการใช้กับ 03 |
|---|---|
| image_id | ตัวผูก prediction กับภาพใน manifest อยู่ที่ evaluation harness ไม่ใช้หาสินค้า |
| product_id | สินค้าของตัวขวดที่มนุษย์ทราบ ใช้แบ่งกลุ่มประเมิน ไม่บังคับให้ prediction ตรง |
| label_product | สินค้าที่ฉลากระบุ เป็น ground truth ของมนุษย์ ไม่ส่งเป็น feature เข้า 03 |
| expected_product | งานที่ระบบถูกตั้งให้รับ ส่งเข้า inspect_image ในรอบนั้น |
| detected_product | ผลจำแนกฉลากจาก 03 อาจ null; ห้ามนำไปเขียนทับ label_product |
| result/reason ใน manifest | ground truth อิสระจาก result/reason ของ Decision |

กฎที่ 03 ทำและมี regression test แล้ว: misplaced_label ต้องมีฉลากที่เห็นเพียงพอ;
หากฉลากผิดชนิดและเลื่อนพร้อมกัน reason หลักคือ wrong_label
05 ยังต้องทวนและยืนยัน ground truth ให้ตรงลำดับนี้ก่อนใช้ประเมินรวม
ภาพไม่พอ/ฉลากหันหนีเป็น REVIEW; ยังไม่มี profile สำหรับ FAIL/missing_label

อ้างอิงเครื่องมือ 05 จาก [evaluate.py ใน PR #13 ณ commit eaf1f4f](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/eaf1f4f716027456edeaa0ec21b3e87d1d008f86/05_dataset_testing/evaluate.py)
และ [prediction header](https://github.com/Mekmai4234/Image-Processing-MiniProject/blob/eaf1f4f716027456edeaa0ec21b3e87d1d008f86/05_dataset_testing/templates/predictions.csv)
นี่เป็น snapshot อ้างอิง ไม่ใช่การยืนยันว่า PR #13 รวมแล้วหรือ schema จะไม่เปลี่ยน

Header ที่เครื่องมือนั้นใช้:

```csv
image_id,expected_product,source_mode,result,reason,error_code,config_version,orientation_ms,inspection_ms,storage_ms,total_ms
```

- image_id มาจาก manifest; expected_product/source_mode/result/reason/config_version มาจากรอบตรวจ
- orientation_ms/inspection_ms มาจาก Decision; storage_ms/total_ms ต้องมาจากการวัดของ 04
  **อย่าใส่ 0 หรือแต่ง total ให้ครบเพื่อส่ง pure-function result เข้า evaluator นี้**
  ถ้าประเมิน algorithm อย่างเดียว ให้ 03/05 ตกลง protocol แยกก่อน
- error_code ว่างเมื่อมี product result สำเร็จ; operational error ให้ใส่ error_code
  แล้วเว้น result/reason และ timing ทั้งหมด ไม่แปลง error เป็น FAIL หรือ REVIEW
- storage_status=failed หลังตรวจสำเร็จยังคง product result เดิม ไม่ใส่ error_code ที่ทำให้
  evaluator ตัดภาพนั้นออกจาก valid inspections; เก็บรายละเอียด storage error แยกในรายงาน
- เครื่องมือ snapshot นี้จับคู่ (image_id, expected_product) ต่อหนึ่ง mode/split
  multi-view ต้องตกลง case protocol เพิ่ม ไม่รวมผลแบบหลายมุมเป็น single-view accuracy
- run metadata ต้องมี dataset/config version, commit/hardware/resolution, hashes ของ
  manifest/catalog/provenance, config_locked และ locked_at จริงก่อน final evaluation

## 5. หลักฐาน templates และการล็อกข้อมูล

ก่อนใช้ catalog จริง 03/05 ต้องมีตาราง references ที่ตรวจย้อนกลับได้อย่างน้อย:
product_id ของ template (ต้องตรง label_product), template identifier/hash,
source image_id, source image hash, crop/ขั้นตอนแปลง, physical_bottle_id,
capture_session, split_group_id, split=development, dataset version และ manifest hash
เก็บตาม schema/ตำแหน่งที่ 05 ดูแล ไม่สร้าง ground truth ใหม่จาก prediction

เลือกภาพที่ visible_enough และฉลาก/ชนิดได้รับการตรวจโดยมนุษย์
ทั้งขวด/session/duplicate/augmentation ต้องอยู่ split เดียวกันตาม dataset guide
เมื่อ split หรือ source image เปลี่ยน ต้องตรวจ references ใหม่; ที่ย้ายออกจาก
development ต้องถอน/เลือกใหม่ พร้อมเพิ่ม config_version และทำ validation ใหม่
ห้ามนำ final test มาเลือก templates ปรับ threshold หรือแก้ ground truth ให้ตรงโปรแกรม

ก่อน validated=True ต้องมีรายงาน validation จริงของ config_version นั้น:
จำนวนภาพ/ขวด/session, เกณฑ์คุณภาพ/ตำแหน่ง/คะแนน, ผลผิดพลาด, false pass/false reject/
REVIEW rate, dataset/split/reference hashes และข้อจำกัดขวดใส/แสง/ฉลากโค้ง
ล็อก config และ final test ก่อนประเมินสุดท้าย; denominator ว่างรายงาน N/A
baseline นี้ยังไม่มีข้อมูลหรือรายงานเหล่านี้ จึงยังไม่ตั้ง config จริงให้ validated

## 6. สถานะตาม review

| รายการ | สิ่งที่ทำใน 03 / สิ่งที่ยังรอ |
|---|---|
| Signature และ Decision mapping | มี projection + tests + ข้อเสนอนี้; รอ 04 ยืนยันและต่อ HTTP จริง |
| Error mapping | ทดสอบว่า input/config error เป็น exception; รอ 04 ทำ status/error body |
| Catalog/config ที่เชื่อถือได้ | ระบุ boundary; รอ 04 loader และข้อมูลจริงจาก 03/05 |
| Detector tests ใน CI | มี run_checks.py/requirements-test.txt; รอ 04/05 เพิ่ม workflow ส่วนกลาง |
| Product fields / GT precedence | ระบุ mapping และ tests; รอ 05 ทวน manifest/กรณีกำกวม |
| Templates provenance / split changes | มี checklist; รอข้อมูลจริงและ schema/การตรวจของ 05 |
| Real validation / final test | ยังไม่มีข้อมูลจริง; ต้องทำร่วมกันก่อนอ้าง accuracy |

เอกสาร review ต้นฉบับยังเก็บนอก repository ไม่คัดลอกเข้า commit
