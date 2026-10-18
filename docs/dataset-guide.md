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

## หลายมุม

จับกลุ่ม physical_bottle_id + capture_session; แต่ละภาพระบุ angle_deg ถ้ารู้
ชุดเริ่มต้นอาจ 12 ภาพ 0..330° ทีละ 30°; 4 ภาพทำ prototype ได้แต่ coverage ไม่เท่ากัน
หลายมุมต้องมาจากขวดเดียวกัน ไม่จับขวดคนละใบมาทำเป็นการหมุนหนึ่งรอบ

## Split และการประเมิน

เป้าหมาย 60% development / 20% validation / 20% final test โดย group ระดับขวด/session
ภาพเดิม คนละ expected product และ augmentation ต้องอยู่ split เดียวกัน
templates ห้ามซ้ำกับภาพ final test; validation ใช้ปรับ threshold ส่วน test ใช้รายงานผล
ตรวจ hash duplicate และ reviewer ตรวจ ground truth อย่างน้อยสองคนสำหรับเคสกำกวม
จำนวนเริ่มประมาณ 200 ภาพเป็นแผนเก็บ ไม่ใช่จำนวนที่รับประกันความแม่นยำ

## การนำ Log กลับมาใช้

prediction ไม่ใช่ ground truth; เพิ่ม reviewed_result/reviewer ก่อนย้ายเป็น dataset รุ่นใหม่
เก็บแหล่งที่มา เวอร์ชัน และสิทธิ์ของภาพ ถ้าใช้ข้อมูลสาธารณะให้ทำตาม license
ภาพจริงอยู่ datasets/ ซึ่ง ignore และแชร์แยก ไม่เผยแพร่ capture ขึ้น public อัตโนมัติ
