# Config document v1 สำหรับ loader ของ 04

สถานะ 21 ตุลาคม 2026: มี schema boundary, crop/provenance checks และ tests แล้ว
ยังไม่มี config ของสองยี่ห้อจริง ไม่มี templates/validation report จริงใน repository
จึงยังไม่เปิดตรวจจริงหรืออ้างความแม่นยำ ผู้รับผิดชอบ 03/05 ต้องเลือกสินค้าก่อน

`build_detector_config()` เป็นตัวอ่าน dict ที่เข้มงวดและไม่ทำ filesystem I/O
04 โหลด JSON, catalog กลาง, manifest ที่ผ่าน gate ของ 05, source images และ report
จากแหล่ง Backend ที่ควบคุมได้ แล้วส่งข้อมูลเข้าฟังก์ชันนี้ ห้ามรับ config จาก browser
การรับ dict ไม่ได้ทำให้ HTTP loader/startup ของ 04 ถูกติดตั้งให้อัตโนมัติ

## Schema ที่รับ

Root object รับ fields ต่อไปนี้เท่านั้น ทุก field จำเป็น:

| Field | ชนิด / ข้อกำหนด |
|---|---|
| schema_version | `detector-config-v1` |
| config_version | string ไม่ว่าง เปลี่ยนเมื่อ templates/thresholds/rules เปลี่ยน |
| dataset_version | string ไม่ว่าง อ้าง dataset ที่ใช้เลือก references/ปรับเกณฑ์ |
| manifest_sha256 | SHA-256 lowercase 64 ตัวของ bytes ไฟล์ manifest ปัจจุบัน |
| catalog_sha256 | `catalog_fingerprint(catalog)` ตามนิยามด้านล่าง |
| parameters | fields ของ DetectorConfig ยกเว้น products/config_version/validated/validation_reference |
| products | list ไม่ว่าง; product_id ทุกตัวต้องตรงชุด catalog กลาง ไม่มีตัวซ้ำ/ขาด/เกิน |
| validated | boolean; เริ่ม false จนมีหลักฐานจริงที่ตรวจโดยทีม |
| validation_reference | null เมื่อ unvalidated; report_id เมื่อ validated |

parameters ที่ต้องระบุ: min_sharpness, min_match_score, min_match_margin,
background_distance, max_background_spread, label_contrast, min_bottle_area,
label_width_range และ label_height_range
parameters เสริม: max_image_pixels, max_total_pixels, max_views, match_size, min_pattern_std
ชนิด/ขอบเขตใช้ `DetectorConfig.validate()` เดิม ไม่แปลง string/bool ให้เป็นตัวเลขเงียบ ๆ
ROI/tolerance/thresholds ทุกค่าต้องกำหนดจาก requirement และ validation ของสินค้าจริง

product object มี `product_id`, `position`, `references` เท่านั้น
position มี expected_roi=[x,y,w,h], center_tolerance=[x,y], size_tolerance=[w,h], max_tilt_deg
พิกัดทั้งหมดสัมพันธ์กับ bottle ROI; ไม่ได้ normalize ด้วยขนาดภาพทั้งเฟรม

reference object แต่ละตัวต้องมี fields ทั้งหมดต่อไปนี้:

```text
template_id, source_image_id, source_sha256, template_rgb_sha256,
physical_bottle_id, capture_session, split_group_id, split, label_product,
source_dimensions, crop, crop_method
```

- template_id ไม่ซ้ำทั้ง config; source_image_id อ้าง image_id ใน manifest ปัจจุบัน
- split ต้องเป็น development ทั้งใน reference และ manifest; visible_enough ใน manifest ต้อง yes
- label_product ต้องตรง product_id ของ template; product_id ของตัวขวดไม่ใช้แทนชนิดฉลาก
- physical_bottle_id/capture_session/split_group_id/label_product ต้องตรง manifest
- source_dimensions=[width,height] หลัง EXIF; crop=[x,y,width,height] เป็น integer pixels
  ที่อยู่ภายใน source; crop_method=`exif-rgb-axis-aligned-v1`
- 03 crop จาก source จริงที่ส่งเข้ามา ไม่รับรูป template อิสระที่ไม่มีที่มา
- source_sha256 คือ hash ของ source file bytes ซึ่ง 04 ต้องอ่านและคำนวณเองก่อน decode
- template_rgb_sha256 ใช้ `rgb_fingerprint(cropped_rgb)` ไม่ใช่ hash ของไฟล์ JPG/PNG

## นิยาม hash และการเรียก

```python
from app.inspection import build_detector_config

def configure_03(document, catalog, manifest_rows, manifest_sha256,
                 source_images, source_file_hashes, report):
    return build_detector_config(
        document,
        catalog=catalog,
        manifest_rows=manifest_rows,
        manifest_sha256=manifest_sha256,
        source_images=source_images,
        source_sha256=source_file_hashes,
        validation_report=report,
    )
```

source_images เป็น `{image_id: RGB uint8 ndarray}` หลัง decode/EXIF หนึ่งครั้งโดย 04
source_file_hashes เป็น `{image_id: SHA256(actual_source_file_bytes)}`
manifest_rows มาจาก manifest ปัจจุบันเดียวกับ manifest_sha256 ไม่ส่งสำเนาเก่าหรือบางแถว
05 เป็นเจ้าของตรวจ group leakage/duplicate และล็อก split ทั้ง dataset ก่อน loader ใช้งาน
03 ตรวจ metadata ของ references กับ manifest แต่ไม่ได้แทน dataset audit ของ 05

rgb_fingerprint: SHA256 ของ ASCII `RGB:uint8:WIDTH:HEIGHT:` ตามด้วย C-order RGB bytes
catalog_fingerprint: canonical JSON ของ product_id/display_name/brand/size_ml เท่านั้น
เรียงสินค้าโดย product_id, JSON sort_keys=True, separators=(',', ':'), ensure_ascii=False
แล้ว SHA256 ของ UTF-8 bytes ไม่รวม readiness/URLs ที่เปลี่ยนได้ตาม runtime
ชื่อสินค้า API และ detector ต้องมาจาก catalog เดียวกันที่ผ่านการเทียบ hash นี้

config_fingerprint: canonical JSON แบบเดียวกันของ document ทั้งก้อนยกเว้น
validated/validation_reference เพื่อผูก report กับค่าที่นำไป calibrate ก่อนเปิดใช้งาน
hash จึงครอบคลุม parameters, dataset/catalog/manifest hashes และ crop/provenance ทั้งหมด
หลังเปลี่ยน split/source/crop/thresholds ต้องตรวจ references ใหม่และทำ validation ใหม่

## Validation report binding

เมื่อ validated=True ต้องส่ง report ที่อ่านจาก Backend; fields ต่อไปนี้ต้องตรง:

| Field ของ report | ค่า |
|---|---|
| report_id | validation_reference |
| config_version/dataset_version/manifest_sha256 | เวอร์ชันและ hash ใน document |
| config_sha256 | config_fingerprint(document) |
| split | validation |
| data_kind | real |
| status | completed |
| sample_count | integer มากกว่า 0 |

Report สามารถมี metrics/จำนวนต่อคลาส/ข้อจำกัดเพิ่มได้ 03/05 ต้องอ่านผลจริงและตกลง
เกณฑ์ยอมรับก่อนเปิด validated; การผ่าน binding นี้ **ไม่พิสูจน์ว่า report เป็นของแท้
หรือ accuracy ผ่านเกณฑ์** จึงต้องใช้ loader ที่เชื่อถือได้ ไม่เชื่อ client flags
catalog ที่ validated ต้องมี brand และ size_ml จริง ไม่ใช่ placeholder ว่าง
references ที่ไม่มี pattern ใช้ matching ไม่ได้จึงเปิด validated ไม่ได้

ฟังก์ชันไม่อ่านไฟล์ report จาก validation_reference เพื่อป้องกันการใช้ arbitrary paths
04 map InspectionConfigError เป็น startup/config error หรือ 503 และไม่ fallback เป็น DEMO
หากตั้ง config แบบ unvalidated ได้ ตัวตรวจจะยังคืน REVIEW เมื่อจับคู่ได้ตามกฎเดิม
ไม่มี config/templates เลยให้ 04 คง 503; ห้ามเอา synthetic_config จาก tests มาทดแทน

## สิ่งที่ยังต้องทำกับข้อมูลจริง

1. 03/05 ยืนยัน 2 ยี่ห้อ รุ่น/ขนาด และ product_id กลาง แล้วกำหนด ROI/tolerance จริง
2. 05 เก็บ manifest/provenance แยกขวด/session/split; เลือก references จาก development
3. 03 ทดลอง baseline กับขวดใส/แสงสะท้อน/ฉลากโค้ง ปรับวิธีและ thresholds จาก validation
4. 05 ออกรายงานและ hashes ของ config ที่ล็อกแล้ว ให้ 04 โหลดข้อมูลชุดเดียวกับ products API
5. ประเมิน final test โดยไม่ปรับ templates/thresholds จาก final test และรายงานข้อจำกัด
