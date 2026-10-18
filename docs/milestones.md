# แผนรอบส่งงาน

ใช้ milestone บน GitHub ตามชื่อด้านล่าง ไม่มีวันครบกำหนดจนทีมกำหนดจริง

## M1 — Foundation & contract

- 01: app shell และ navigation 3 หน้า
- 02: scene geometry + state machine ด้วย mock ที่มีป้าย DEMO
- 03: function signature, product config และ baseline locator
- 04: health/products + storage config + camera manual preview
- 05: เลือกสินค้าจริง manifest และ split กลุ่มข้อมูลชุดแรก
- ผ่านเมื่อ: อ่าน contract เดียวกัน ทุกส่วนมีวิธีทดสอบและยังแยก mock จากจริง

## M2 — Upload inspection & local logs

รับภาพจริง → ตรวจ → bbox/score/reason → บันทึก → History
ทดสอบ save failure/retry/idempotency; ล็อก contract รอบแรก

## M3 — Webcam & orientation simulation

กล้องจริง manual capture/guidance, หลายมุมจำลอง, wait result, pass/reject routing
ทดสอบออกหน้า/reset/timeout ไม่ส่งผลผิดขวด; auto capture หลัง manual ใช้ได้

## M4 — Validation & presentation

ปรับด้วย validation → lock config → final test → report → สาธิตครบ 3 หน้า
เพิ่มความสวยงาม responsive และแก้ UX/error ที่พบ พร้อม PR develop เข้า main

เจ้าของงานแต่ละคนแตก Issue หลัก 01–05 เป็นงานย่อยของแต่ละ milestone
issue หลักไม่ควรถูก close จนเกณฑ์ส่งมอบทั้งส่วนครบ
