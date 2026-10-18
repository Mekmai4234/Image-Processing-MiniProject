# ขอบเขตและเกณฑ์รับงาน Vending Vision

## MVP

1. ขวดไทย 2 ยี่ห้อ ยี่ห้อละ 1 รุ่น/ขนาด ใช้ product_id ชัดเจน
2. Simulation แยกหน้า Webcam; ประวัติร่วมพร้อม source_mode
3. upload ภาพเดียว หรือหลายมุมของขวดเดียว; เห็นสิ่งที่ใช้ตรวจจริง
4. Webcam เปิดหลัง click/permission, manual capture ก่อน auto capture
5. หาฉลาก ตรวจชนิด/ตำแหน่ง คุณภาพภาพ และส่ง PASS/FAIL/REVIEW
6. bbox ที่ฉลาก: เขียว PASS, แดง FAIL, เหลือง REVIEW; missing ใช้ expected ROI เส้นประ
7. score คือ template similarity ไม่ใช่ความน่าจะเป็นความถูกต้อง
8. จำลอง feed/orient/inspect/sort/output ด้วยผลจริง ไม่สุ่มตาม animation timer
9. local backend เก็บ original/annotated/result.json + SQLite และ export CSV
10. ประวัติเปิดภาพได้หลัง restart และแยก storage error ออกจากผลตรวจ

## กติกาผลตรวจ

- PASS: มีหลักฐานพอ ฉลากตรง expected_product และผ่านตำแหน่ง
- FAIL: หลักฐานพอและผิดกฎชัด เช่น wrong_label, misplaced_label, missing_label ที่ยืนยันได้
- REVIEW: ยังตรวจไม่ได้ เช่น ภาพเบลอ ฉลากหันหนี unknown product หรือ match สูสีกัน
- ERROR: ปัญหาระบบ เช่นกล้อง/API/ดิสก์ ไม่ใส่เป็น product result

REVIEW ไม่เข้า PASS ในฉากจำลอง ให้คัดออก/รอถ่ายใหม่โดยบันทึกเหตุผลแยกจาก FAIL
ภาพเดียวที่หันหลังไม่พอจะยืนยัน missing_label; ต้องมี required-view profile ที่ validate และ Backend ตรวจหลักฐานผ่านตาม API contract v0.2
การผิดชนิดเทียบ expected_product ไม่ยืนยันว่าน้ำภายในแท้หรือปลอดภัย

## ส่วนต่อยอดหลัง MVP

auto capture เมื่อภาพนิ่ง, ปรับมุมละเอียด, queue หลายขวด, เพิ่มสินค้า,
แท่นหมุนจริงหรือกล้องภายนอก (หากทีมมีอุปกรณ์และเวลาทดสอบ)

## เกณฑ์ตำแหน่ง

กำหนดต่อ product ด้วย normalized bottle ROI แล้วตกลงก่อน annotate
ตัวอย่างเริ่มคุย: center offset ไม่เกิน 10% และ tilt ไม่เกิน 10°
ตัวเลขนี้ยังไม่ validate ต้องกำหนดจริงกับทีมและ validation set พร้อม config_version

## เกณฑ์รับรวม

ทดสอบ PASS/FAIL/REVIEW อย่างละกรณีจริงทั้ง 2 โหมด,
ไม่เปลี่ยนสินค้าเพราะ storage error, reject ตรง id, retries ไม่ซ้ำ,
ปิดกล้องเมื่อเปลี่ยนหน้า, เก็บไฟล์ครบ, และมีรายงาน false pass/false reject/review rate
เป้าความแม่นยำและเวลาให้ทีมกำหนดหลัง baseline ก่อนใช้ final test; ยังไม่มีตัวเลขรับรอง
