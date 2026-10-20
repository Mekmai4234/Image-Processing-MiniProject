# งาน 03 — ตัวตรวจฉลาก baseline

สถานะ: มี pure functions และการทดสอบด้วยภาพสังเคราะห์แล้ว ยังไม่มีภาพขวดไทยจริง,
catalog จริง, templates จริง หรือผล validation/final test จึงยังไม่รับรอง accuracy
และยังไม่ถือว่างานตรวจฉลากจริงครบเกณฑ์ส่งมอบ

โค้ดส่วนนี้ไม่เปิดกล้อง ไม่เรียก HTTP ไม่โหลด .env และไม่อ่าน/เขียนไฟล์หรือฐานข้อมูล
งาน 04 เป็น adapter ให้ทั้ง Simulation และ Webcam เรียกตัวตรวจเดียวกัน

## จุดเรียกใช้สำหรับ 04

เมื่อเพิ่ม `apps/backend` ใน Python import path จะ import ได้ดังนี้:

```python
from app.inspection import (
    DetectorConfig, Evidence, InspectionInputError, InspectionConfigError,
    locate_label, inspect_image, annotate_image,
)


def run_inspection(rgb_image, expected_product, config: DetectorConfig):
    location = locate_label(
        rgb_image, expected_product, config, color_order="RGB",
    )
    decision = inspect_image(
        rgb_image, expected_product, config,
        color_order="RGB", source_mode="webcam",
    )
    annotated_rgb = annotate_image(rgb_image, decision, color_order="RGB")
    return location.to_dict(), decision.to_dict(), annotated_rgb
```

`rgb_image` เป็น numpy array uint8 H×W×3 ที่ decode และแก้ EXIF แล้ว
ขนาดอย่างน้อย 8×8; color_order ต้องระบุ RGB/BGR ทุกครั้ง ไม่เดาจากข้อมูล
ทุกภาพในคำขอใช้ช่องสีแบบเดียวกัน ส่วน templates ใน config เป็น RGB เท่านั้น
04 เป็นเจ้าของ decode/EXIF/การ encode กลับเป็น JPG เพียงครั้งเดียว
หากใช้ `cv2.imwrite` ภายหลังต้องแปลงผล annotated จาก RGB เป็น BGR ก่อน
original และ templates ของผู้เรียกไม่ถูกวาดทับหรือเปลี่ยนค่า

`InspectionInputError` เป็น invalid input ไม่ใช่ FAIL ของสินค้า ให้ 04 map เป็น
operational error ตามประเภท/HTTP contract; `InspectionConfigError` เป็นปัญหา
configuration/service ไม่ใช้เป็น product result หรือสร้าง History เสมือนตรวจแล้ว

## Config ที่ต้องจัดเตรียมกับ 05

สร้าง `ProductConfig` ต่อสินค้าด้วย product_id, tuple ของ RGB label templates และ
`PositionRules` แล้วรวมเป็น `DetectorConfig` พร้อม config_version
ไม่มี loader/catalog สมมุติใน production module; 04 โหลดของจริงแล้วส่งเข้ามา

| ค่า | ความหมาย |
|---|---|
| position.expected_roi | x/y/width/height ช่วง 0..1 เทียบทั้ง bottle ROI |
| center_tolerance | คลาดเคลื่อนศูนย์กลาง x/y หน่วยสัดส่วนของขวด |
| size_tolerance | คลาดเคลื่อนขนาด w/h หน่วยสัดส่วนของขวด |
| max_tilt_deg | ความเอียงที่ยอมรับจากแกนนอน หน่วยองศา |
| min_sharpness | Laplacian variance ขั้นต่ำบน label candidate หรือ bottle เมื่อไม่พบฉลาก |
| min_match_score / min_match_margin | คะแนนขั้นต่ำและส่วนต่างจากสินค้าอันดับสอง |
| background_distance / max_background_spread | ระยะสีใน OpenCV LAB uint8 สำหรับแยกขวด/ตรวจพื้นหลัง |
| label_contrast | ระยะสี LAB ของ candidate ต่างจากสีส่วนใหญ่ของขวด |
| min_bottle_area | พื้นที่ contour ขั้นต่ำเทียบภาพทั้งหมด |
| label_width_range / label_height_range | min/max ขนาด candidate เทียบ bottle ROI |
| max_image_pixels / max_total_pixels | จำกัด pixels ต่อภาพ/รวมภาพทั้งหมดก่อนทำสำเนา |
| max_views | จำนวนภาพหลัก + supporting images สูงสุด |
| match_size / min_pattern_std | ขนาดปรับเทียบ และส่วนเบี่ยงเบนมาตรฐาน grayscale ขั้นต่ำ |

ค่า threshold หลักต้องส่งอย่างชัดเจน ไม่ได้กำหนด universal defaults ให้ขวดทุกยี่ห้อ
ค่าใน test fixtures เป็นของภาพวาดทดสอบเท่านั้น ห้ามใช้แทนเกณฑ์ขวดจริง

`validated=False` เป็นค่าเริ่มต้น: ถ้าจับคู่ฉลากได้จะยังคืน REVIEW/ambiguous_match
พร้อม diagnostics.limitation=configuration_not_validated ทั้งฉลากตรงและผิดสินค้า
เมื่อ 03/05 ทดสอบ validation จริงแล้ว ผู้ดูแล config จึงตั้ง validated=True พร้อม
validation_reference ที่อ้างรายงานนั้น การตั้ง flag นี้เป็นความรับผิดชอบของ config
ฝั่ง Backend ไม่ใช่ field รับจาก client และไม่ได้ทำให้เกิดการ validate อัตโนมัติ

## พฤติกรรมและพิกัด

Pipeline: validate pixels → quality/bottle ROI → label candidates → rectified crop
→ เทียบทุกสินค้า → identity → position → decision → annotation แยกเมื่อต้องการ

- Locator คืน canonical fields ตาม contract: usable_view/bbox/image_width/image_height/
  quality/reason ฉลากผิดสินค้าที่เห็นชัดยัง usable ได้
- Bottle ROI กับ label bbox แยกกัน ภาพตัดขวด/ไม่เห็นบริเวณขวดพอจะเป็น REVIEW
- ภาพเบลอคืน REVIEW/blurred_image; ไม่พบฉลากไม่สร้าง bbox สมมุติ
- candidates หลายบริเวณให้ REVIEW/ambiguous_match ไม่เลือก PASS จากบริเวณที่บังเอิญตรง
- เปรียบเทียบ normalized grayscale patterns ด้วย TM_CCOEFF_NORMED
  finite raw [-1,1] → max(0,raw) ตาม template_ccoeff_normed_clamped_v1
  flat template/input หรือ raw ผิดปกติให้ null score / ambiguous_match
- ต่ำกว่า threshold ให้ unknown_product; คะแนนอันดับต้นสูสีให้ ambiguous_match
  ทั้งสองกรณีคืน null score เพราะยังไม่มีการจับคู่ที่เชื่อถือได้
- เมื่อ config validate แล้ว ลำดับตัดสินคือ quality → identity → position
  ผิดชนิดและเลื่อนพร้อมกันใช้ wrong_label เป็นเหตุผลหลัก
- ตำแหน่ง/ขนาดสัมพันธ์กับขวด ไม่ใช่กึ่งกลางภาพ มีการวัดความเอียงและ rectification
  สำหรับฉลากที่เอียงเล็กน้อย แบบแกนนอนเป็นหลัก
- ไม่มีการ resize ภาพเต็มหรือส่งพิกัด crop ออก: bbox/expected_bbox เป็น pixel ของภาพหลัก
  หลัง EXIF ที่รับเข้ามาเสมอ annotation คืนภาพ RGB ใหม่
- PASS เขียว / FAIL แดง / REVIEW เหลือง; annotation รองรับ missing-label expected ROI
  แบบเส้นประ แต่ detector รุ่นนี้ยังไม่สร้าง FAIL/missing_label

Decision เป็น internal result ไม่ใช่ InspectionResult HTTP ทั้งก้อน:
04 เติม IDs, created_at, storage_status/error, URLs, reviewed_* และ timings storage/total
ใช้ `decision.to_inspection_fields()` เพื่อรับสำเนาเฉพาะ fields สำหรับประกอบ API
รวม evidence ที่รักษาจำนวน/index ของภาพเสริมด้วย null placeholders แต่ยังไม่ใช่ response ครบ
รายละเอียด mapping, ข้อเสนอ error handling และข้อมูลที่ต้องประสานกับ 05 อยู่ใน
[เอกสารส่งต่อหลัง review](HANDOFF.md) ซึ่งยังรอ 04/05 ยืนยัน
`timing_ms` ภายในมีเฉพาะ orientation/inspection ที่วัดจริง เวลาเปลี่ยนแต่คำตัดสิน
กรอบและคะแนนต้องเหมือนเดิมเมื่อ pixels/config เดิม

## หลักฐานหลายมุม v0.2

ส่ง `supporting_images` เป็น tuple/list ที่เรียงตรงกับ
`Evidence.supporting_angles_deg` พร้อม kind/search_status/reported_coverage_deg
มุมไม่ทราบใช้ None; ทุกภาพต้องเป็นขวดเดียวกัน ผู้จัดชุดข้อมูล/adapter ดูแลเงื่อนไขนี้
baseline ยังไม่สามารถพิสูจน์เอกลักษณ์ขวดข้ามภาพด้วย pixels ได้

รุ่นนี้ประเมิน locator ของภาพเพิ่มเติมและคืน `evidence_assessment`:

- verified_coverage=False และ required_view_profile=None เสมอ เพราะยังไม่มี profile ที่ validate
- supporting_indices อ้างทุกภาพที่ 04 ต้องเก็บตามลำดับ ห้ามกรองทิ้ง
- usable_supporting_indices และ supporting_locator_results ช่วยให้ผู้เรียกเลือกภาพหลักรอบถัดไป

คำตัดสิน/กรอบยังยึดภาพหลักที่ส่งมา หากภาพหลักไม่พอแต่ภาพเสริมใช้ได้ ให้ REVIEW
แล้วเลือกภาพที่ใช้ได้เป็นภาพหลักในคำขอใหม่ ไม่ยืม bbox จากภาพอื่นมาวาดทับภาพหลัก
exhausted/timed_out ที่ไม่พบฉลากให้ REVIEW/orientation_failed; ภาพเบลอยังคง blurred_image
หากภาพหลักดีพออยู่แล้ว สถานะ exhausted/timed_out ไม่ทับหลักฐานนั้น
จำนวนมุมและ reported_coverage_deg=360 ไม่ทำให้เกิด FAIL/missing_label
04 แปลง evidence_assessment เป็น evidence ของ API และสร้าง supporting image URLs หลังจัดเก็บ

## ข้อจำกัดและงานถัดไป

ใช้กับขวดเดี่ยวตั้งตรงบนพื้นหลังสีเรียบ มีขอบแยกจากฉากหลังและฉลากเด่นพอ
ยังไม่รับรองขวดใส/พื้นหลังซับซ้อน แสงสะท้อน การบัง ฉลากโค้ง หรือ perspective รุนแรง
การเปรียบเทียบ grayscale อาจแยกฉลากที่ต่างกันเพียงสีไม่ได้ ต้องทดสอบกับสินค้าจริง
ก่อนเลือกวิธีเพิ่ม ข้อมูลหลายมุมยังช่วยเลือกมุม ไม่ใช่ระบบยืนยัน missing label

งานถัดไปของ 03/05: เลือกสินค้า → เก็บภาพแยกกลุ่มขวด/session → เลือก templates จาก
development → ทดลอง baseline/ปรับวิธีที่พลาด → ปรับ threshold ด้วย validation →
ล็อก config → ให้ 05 ประเมิน final test และรายงาน false pass/false reject/REVIEW rate
ไม่ใช้ผล unittest ด้านล่างแทนรายงานความแม่นยำจริง

วิธีรันทดสอบและหลักฐานที่วัดจริงอยู่ใน [คู่มือทดสอบ 03](../../tests/inspection/README.md)
