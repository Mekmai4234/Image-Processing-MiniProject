# Silhouette interface ให้ 02 — bottle-silhouette-v1

เป็น interface ภายใน **แยกจาก InspectionResult** ไม่มี HTTP endpoint ใหม่ และยังไม่ใช่
โมเดล 3D ที่รู้ด้านหลังจากภาพเดียว ใช้ silhouette ของขวดตั้งตรงบนพื้นหลังเรียบเพื่อ
ประมาณผิวหมุนรอบแกนเท่านั้น mask/profile ไม่เป็นหลักฐาน PASS/FAIL ของฉลาก

```python
from app.inspection import ShapeConfig, analyze_shape

def shape_for_02(rgb_image, detector_config):
    settings = ShapeConfig.from_detector(detector_config)
    return analyze_shape(rgb_image, settings, color_order="RGB")
```

หากยังไม่มี detector config สามารถสร้าง ShapeConfig โดยระบุ background_distance,
max_background_spread, min_bottle_area จากสภาพถ่ายที่ทีมทดสอบเอง การทำ geometry
ไม่ต้องมี product/templates; ใช้ segmentation implementation ร่วมกับ locator ของ 03
ตัวเลขของ tests เป็นของ fixture ไม่ใช่ค่าที่ validate กับขวดไทยจริง

## Fields และแกนพิกัด

- schema_version: bottle-silhouette-v1
- status: ready หรือ fallback; reason ระบุเหตุผล ไม่คืน PASS/FAIL
- image_width/image_height: ขนาดภาพหลักหลัง EXIF ที่ผู้เรียก normalize แล้ว
- bbox และ contour: pixel coordinates ของ source เต็มขนาด; จุด (0,0) มุมซ้ายบน
  x ไปขวา y ลงล่าง contour เป็น tuple ของ (x,y)
- mask: ndarray uint8 H×W ค่า 0/1 ขนาดเท่าภาพเต็ม ในหน่วยความจำ ไม่ใช่ URL
- normalized_width/normalized_height: bbox.width/image_width และ bbox.height/image_height
- aspect_ratio: bbox.width/bbox.height
- radial_profile: 32 samples เริ่มต้น (ตั้งได้ 8..256) แต่ละจุดมี y_fraction
  และ radius_over_height โดย y_fraction=0 ด้านบนขวด, 1 ด้านล่าง
  radius_over_height คือครึ่งความกว้าง silhouette แถวนั้น หารด้วย bbox.height
- quality: whole_bottle_visible, center_drift และ axisymmetric_assumption
  เป็นข้อจำกัด/geometry gates ไม่ใช่ calibrated confidence

02 แปลงเป็น world units เมื่อกำหนดความสูง H:

```text
world_y = (1 - y_fraction) * H
world_radius = radius_over_height * H
```

จัด profile จากล่างไปบนตามที่ mesh library ต้องการ ภาพ mirror เปลี่ยน source x
แต่ radius profile เป็นขนาด silhouette; อย่านำ bbox คนละภาพมาใช้เป็น label overlay
สี/texture ด้านที่ไม่ได้เห็นยังต้องอธิบายว่าเป็น representation ไม่สร้างหลักฐานใหม่

`to_dict()` คืน metadata/contour/profile แบบ JSON-ready โดยไม่คัดลอก mask ก้อนใหญ่
หากต้องใช้ JSON mask ในเครื่องมือทดสอบเรียก to_dict(include_mask=True) อย่างชัดเจน
สำหรับ production ให้ 02/04 ตกลง binary/PNG transport และขีดจำกัดก่อนเพิ่ม API
mask read-only ใน result; หากผู้เรียกต้องแก้ให้ copy ก่อน

## Fallback

พื้นหลังไม่เรียบ, ไม่พบขวด/มีหลายวัตถุหลัก, ภาพตัดขวด, ขวดไม่ตั้งตรง,
silhouette ไม่ครบ หรือแกนกลางคดเกินเกณฑ์ จะคืน fallback พร้อม reason
ไม่มี bbox/mask/contour/profile สมมุติให้ดูเหมือนวิเคราะห์สำเร็จ
02 ใช้ generic model พร้อมบอกสถานะ fallback ตาม UX ของตน ไม่เปลี่ยนผลตรวจฉลาก
ค่า whole_bottle_visible ใน quality เป็น heuristic ไม่ใช่โมเดลรู้จำวัตถุว่าเป็นขวด

## หลักฐานปัจจุบันและสิ่งที่ยังรอ

มี tests กับภาพสังเคราะห์ทรงตรง/สอบ/เว้าเอว รวม RGB/BGR, resize, mask/contour/profile,
ขวดเอียง/ขอบภาพ/พื้นหลังรบกวนและ fallback พร้อมตรวจว่าคำตัดสินฉลากไม่เปลี่ยน
มี script render_preview.py สร้างภาพตรวจด้วยตาใน environment ของ tests ได้

**ยังไม่มีภาพขวดจริงหลายรูปทรง** จึงยังไม่ถือว่าผ่านการตรวจรับ real silhouette
ขวดใส แสงสะท้อน มือบัง พื้นหลังมีของและรูปทรงไม่สมมาตรยังต้องเก็บข้อมูลกับ 05
03/02/04 ต้องยืนยัน interface/transport/world scale ก่อนใช้ใน scene จริง
