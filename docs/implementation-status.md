> รุ่นล่าสุด: สินค้าอ้างอิงเดียว ไม่มีตัวเลือกมุม ฉากหมุนอัตโนมัติ ผลตรวจ PASS/FAIL เท่านั้น ภาพไม่ชัดหรือหลักฐานไม่พอถูกคัดออกพร้อมเหตุผล ดูนโยบายล่าสุดใน api-contract.md

# สถานะ implementation

อัปเดต 23 ตุลาคม 2026 — ดู [วิธีใช้และผลทดสอบรุ่นรวม](release-2026-10-23.md)

| ส่วน | สถานะ |
|---|---|
| หน้าจอ | React 3 หน้า + Reference setup; dark navy/cyan ตามภาพอ้างอิง |
| Simulation | Three.js จริง, feed/orient/inspect/sort/output, รูปทรงจากภาพ, pause/reset/replay |
| Webcam | getUserMedia + อัปโหลดไฟล์, locator, capture/retry/auto capture |
| Image Processing | OpenCV คุณภาพ/ฉลาก/สินค้า/ตำแหน่ง; ตั้งภาพอ้างอิงได้ 1–2 สินค้า เริ่มใช้ได้ตั้งแต่สินค้าแรก |
| Reference mode | ตัดสินด้วย reference ผู้ใช้ โดยระบุ experimental และ validated=false |
| Storage/History | SQLite + original/annotated/result.json, metadata, ZIP/CSV, search/filter/sort, human review |
| CI | Backend/detector/frontend/dataset/repository tests และ build บน develop/main |
| Independent accuracy | ยังไม่มี validation/test ของสินค้าจริงที่ทีมรับรอง ไม่อ้างตัวเลขความแม่นยำ |
| Physical camera acceptance | ต้องทวนบน notebook และขวดสินค้าจริงของทีม |

DEMO สังเคราะห์แยกจาก reference mode และ validated detector config ไม่ใช้ภาพออกแบบเป็นหลักฐาน accuracy
