# Dataset guide

## ข้อมูลเริ่มต้น

เลือกขวดไทย 2 ยี่ห้อ ยี่ห้อละ 1 รุ่น/ขนาด แล้วกรอก product catalog จริง
รหัส bottle_a/bottle_b เป็น placeholder ไม่ยืนยันว่ารู้จักขวดทุกยี่ห้อ
ถ่ายด้วย Webcam ที่ใช้สาธิตจริง บนพื้นหลังเรียบ แสงกระจาย และไม่ติดบุคคล

## การกำกับคำตอบ

- PASS: มีฉลาก ชัด ชนิดตรง expected และตำแหน่งผ่าน tolerance
- FAIL wrong_label: หลักฐานชัดว่าฉลากผิดกับสิ่งที่คาดหวัง
- FAIL misplaced_label: ฉลากเลื่อน/เอียงเกิน requirement ที่กำหนดไว้
- FAIL missing_label: ยืนยันไม่มีฉลากในด้านที่ต้องมี/ชุดภาพที่เพียงพอ
- REVIEW: เบลอ หันหนี บัง แสงสะท้อน หรือหลักฐานไม่พอ

ภาพด้านหลังหนึ่งภาพให้ REVIEW label_not_visible ก่อนยืนยัน missing
ขวด B เมื่อเลือกสินค้า B อาจ PASS แต่ภาพเดียวกันเมื่อเลือก A เป็น FAIL
จึงต้องเก็บ expected_product แยก product_id/label_product
manifest ตัวอย่างเป็นสังเคราะห์ใน [examples/labels.csv](../examples/labels.csv)

## ความหมาย field สำคัญใน manifest

| Field | ความหมาย |
|---|---|
| image_id | รหัสภาพต้นฉบับ; ภาพเดียวที่ทดลองคนละ expected_product ยังอ้าง image_id เดิม |
| filename | path ภาพจริงสัมพันธ์กับ dataset root |
| physical_bottle_id | รหัสขวดจริงแต่ละใบ คงเดิมเมื่อเปลี่ยน session หรือฉลาก |
| capture_session | รอบถ่ายจริงที่มีสภาพกล้อง/แสงร่วมกัน |
| product_id | สินค้าของตัวขวดที่ผู้เก็บข้อมูลทราบ เป็น ground truth ไม่ได้อนุมานจากฉลากอัตโนมัติ |
| label_product | สินค้าที่ฉลากซึ่งติดอยู่ระบุ; ว่างหากไม่มีฉลากหรืออ่าน/ระบุไม่ได้ |
| expected_product | สินค้าที่ระบบถูกตั้งให้รับในรอบนั้น |
| split_group_id | กลุ่มขวด/session/ภาพที่เชื่อมโยงกัน ต้องอยู่ split เดียวกันทั้งกลุ่ม |
| angle_deg | มุมที่ทราบจริง 0..<360; ว่างเมื่อไม่ทราบ |
| label_present / position_ok / visible_enough | yes / no / unknown; ไม่ใช้ unknown แทน no |
| result / reason | คำตอบตามกติกาและ enum ใน API contract |
| split | development / validation / test |
| reviewer | ผู้ตรวจ ground truth; ตัวอย่างใช้ example-only |

กรณีขวด A ติดฉลาก B ให้ product_id=bottle_a, label_product=bottle_b และระบุ expected_product ตามโจทย์
กรณีหยิบขวด B ทั้งใบให้ product_id และ label_product เป็น bottle_b
ทั้งสองกรณีเมื่อ expected=bottle_a อาจได้ FAIL/wrong_label; แยกสาเหตุใน metadata/บันทึกการเก็บข้อมูล
ไม่เพิ่ม reason=wrong_product โดยที่ API ไม่รองรับ และไม่อ้างว่าภาพฉลากพิสูจน์น้ำภายในขวดได้
ภาพที่ฉลากหันหนีใช้ label_present=unknown หากภาพ/ชุดหลักฐานที่ตรวจไม่พอยืนยันการไม่มีฉลาก
ใช้ label_product เฉพาะ dataset; ผลจากตัวตรวจใช้ detected_product

## หลายมุม

จับชุดภาพหลายมุมของ physical_bottle_id เดียวภายใน capture_session; แต่ละภาพระบุ angle_deg ถ้ารู้
ชุดเริ่มต้นอาจ 12 ภาพ 0..330° ทีละ 30°; 4 ภาพทำ prototype ได้แต่ coverage ไม่เท่ากัน
หลายมุมต้องมาจากขวดเดียวกัน ไม่จับขวดคนละใบมาทำเป็นการหมุนหนึ่งรอบ
ภาพหลักฐานที่ใช้ยืนยัน missing_label ต้องผ่าน required-view profile ของสินค้านั้น
แค่มี 12 ภาพหรือบอกว่าหมุน 360° ยังไม่พอ: ภาพต้องเห็นพื้นที่ที่จำเป็นและคมชัดตามเกณฑ์
หากยังไม่มี profile ที่ validate ให้เคสหลักฐานไม่พอเป็น REVIEW และระบุข้อจำกัดในรายงาน

## Split และการประเมิน

เป้าหมาย 60% development / 20% validation / 20% final test ตามจำนวนข้อมูลที่จัดเป็นกลุ่มได้
ใช้ physical_bottle_id และ capture_session เป็นเงื่อนไขแยกกัน ไม่ใช้เพียงคู่ (ขวด, session):

1. ขวดใบเดียวกันทุก session ต้องอยู่ split เดียวกัน
2. ภาพใน session เดียวกันทุกขวดต้องอยู่ split เดียวกัน
3. ภาพเดิมที่เปลี่ยน expected_product, crop, augmentation หรือ duplicate ต้องอยู่ split เดียวกับต้นฉบับ
4. รวมการเชื่อมโยงทั้งหมดเป็น split_group_id แล้วสุ่มแบ่งทั้งกลุ่ม; ห้ามแบ่งบางภาพในกลุ่มออกไป

ตัวอย่าง ขวด A ถ่าย session 1 และ 2 และขวด B ถ่าย session 2 → ทั้ง A/B และทั้งสอง session อยู่กลุ่มเดียว
วางแผนถ่ายหลายกลุ่มที่เป็นอิสระตั้งแต่ต้น มิฉะนั้นทั้งหมดอาจเชื่อมเป็นกลุ่มเดียวจนแบ่ง 3 ชุดไม่ได้
ยอมให้สัดส่วนคลาดจาก 60/20/20 และรายงานจำนวนจริง ดีกว่าตัดกลุ่มเพื่อให้ได้เปอร์เซ็นต์พอดี
templates ห้ามซ้ำกับภาพ final test; validation ใช้ปรับ threshold ส่วน test ใช้รายงานผล
เลือก references จาก development เท่านั้น; ตรวจ hash duplicate/ต้นทางภาพดัดแปลงและกลุ่มก่อนเริ่มทดลอง
reviewer ตรวจ ground truth อย่างน้อยสองคนสำหรับเคสกำกวม
จำนวนเริ่มประมาณ 200 ภาพเป็นแผนเก็บ ไม่ใช่จำนวนที่รับประกันความแม่นยำ

## การนำ Log กลับมาใช้

prediction ไม่ใช่ ground truth; เพิ่ม reviewed_result/reviewer ก่อนย้ายเป็น dataset รุ่นใหม่
เก็บแหล่งที่มา เวอร์ชัน และสิทธิ์ของภาพ ถ้าใช้ข้อมูลสาธารณะให้ทำตาม license
ภาพจริงอยู่ datasets/ ซึ่ง ignore และแชร์แยก ไม่เผยแพร่ capture ขึ้น public อัตโนมัติ
