# สถานะความสามารถ

| ส่วน | สถานะฐานเริ่มต้น |
|---|---|
| คู่มือ env/step/process 01–05 | พร้อมเริ่มทำงาน |
| Git workflow, API contract, dataset/storage guides | มีเอกสาร |
| CI ตรวจเอกสาร/โครงสร้าง | มีสคริปต์และ workflow |
| HTML conveyor prototype | ทดลองได้ เกณฑ์สีพื้นฐานสำหรับภาพที่ควบคุม |
| React app แยก 3 หน้า | app shell + 3 หน้า + โหมด DEMO รันได้ (apps/web); ยังไม่ประกอบฉาก 02/กล้อง 04 และยังไม่ทดสอบกับ API จริง |
| Three.js conveyor / rotation | M1: scene + state machine ทดสอบกับ mock DEMO; ยังไม่ต่อ API จริง/ภาพจริง และยังไม่ประกอบเข้าหน้า Simulation |
| Webcam capture/guidance | ยังต้องพัฒนา |
| OpenCV inspection ที่ validate กับขวดไทย | ยังต้องพัฒนา/เก็บข้อมูล |
| Local persistence / SQLite / History API | ยังต้องพัฒนา |
| Accuracy / timing ที่วัดจริง | ยังไม่มี |

ทุก PR อัปเดตตามหลักฐานรันจริง พร้อม test/ภาพ/รายงาน ไม่ใช้ภาพ mockup ยืนยันว่าเสร็จ
requirements.txt เป็นรายการเตรียมเครื่องเริ่มต้น ยังไม่ได้ lock จากแอปที่รันทดสอบครบ

ปรับฐานก่อนเริ่มงาน: contract v0.2 รองรับหลักฐานหลายมุม, canonical fields,
ตัวอย่าง UUID, คู่มือ config และตรวจ regression ของ repository
รายการนี้เป็นการเตรียมข้อตกลงและเครื่องมือทีม ไม่ได้เพิ่ม endpoint หรือ webcam ที่รันจริง
