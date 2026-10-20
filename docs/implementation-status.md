# สถานะความสามารถ

| ส่วน | สถานะฐานเริ่มต้น |
|---|---|
| คู่มือ env/step/process 01–05 | พร้อมเริ่มทำงาน |
| Git workflow, API contract, dataset/storage guides | มีเอกสาร |
| CI ตรวจเอกสาร/โครงสร้าง | มีสคริปต์และ workflow |
| HTML conveyor prototype | ทดลองได้ เกณฑ์สีพื้นฐานสำหรับภาพที่ควบคุม |
| React app แยก 3 หน้า | app shell + 3 หน้า + โหมด DEMO รันได้ (apps/web); เชื่อมต่อฉาก 02 และกล้อง 04 แล้ว |
| Three.js conveyor / rotation | M1: scene + state machine ทดสอบกับ mock DEMO; เชื่อมต่อกับหน้า Simulation แล้ว |
| Webcam capture/guidance | มี CameraPanel + locator guidance + cleanup streams (build ผ่าน) ประกอบในหน้า WebcamPage |
| OpenCV inspection ที่ validate กับขวดไทย | มีโมดูล 03 inspect_image + DetectorConfig + template matching v0.2 |
| Local persistence / SQLite / History API | มี FastAPI + SQLite + StorageManager + export CSV + pytest 58 รายการ (ดู apps/backend/README.md) |
| Accuracy / timing ที่วัดจริง | อยู่ระหว่างเก็บข้อมูลและทดสอบในห้องปฏิบัติการ |

ทุก PR อัปเดตตามหลักฐานรันจริง พร้อม test/ภาพ/รายงาน ไม่ใช้ภาพ mockup ยืนยันว่าเสร็จ
requirements.txt เป็นรายการเตรียมเครื่องเริ่มต้น ยังไม่ได้ lock จากแอปที่รันทดสอบครบ

ปรับฐานก่อนเริ่มงาน: contract v0.2 รองรับหลักฐานหลายมุม, canonical fields,
ตัวอย่าง UUID, คู่มือ config และตรวจ regression ของ repository
รายการนี้เป็นการเตรียมข้อตกลงและเครื่องมือทีม ไม่ได้เพิ่ม endpoint หรือ webcam ที่รันจริง
