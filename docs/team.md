# ทีมและการแบ่งงาน

ชื่อโครงการ: Vending Vision; Repository: Image-Processing-MiniProject
เจ้าของ Repository: @Mekmai4234 (ยังไม่ถือว่าเป็นคนที่ 1 โดยอัตโนมัติ)
กรอกชื่อและ username ของสมาชิกจริงก่อน assign Issues / ขอ review

| งาน | ชื่อจริง | GitHub username | ขอบเขต | Branch | ความยาก |
|---|---|---|---|---|---|
| 01 | รอกรอก | รอกรอก | UI/UX, 3 หน้า, overlay, API client | feature/01-web-ui | 3/5 |
| 02 | รอกรอก | รอกรอก | Three.js, conveyor, orient, reject | feature/02-simulation-3d | 4/5 |
| 03 | รอกรอก | รอกรอก | locate/classify/position/score | feature/03-image-processing | 5/5 |
| 04 | รอกรอก | รอกรอก | Webcam, FastAPI, files, SQLite | feature/04-webcam-backend | 4/5 |
| 05 | รอกรอก | รอกรอก | dataset, ground truth, evaluation | feature/05-dataset-testing | 4/5 |

## จุดเชื่อม

- 01 ↔ 02: Scene component, event/state และ stop เมื่อออกหน้า
- 01 ↔ 04: CameraPanel, API client, original image dimensions และภาพ annotated
- 03 ↔ 04: pure inspection function → HTTP/JSON adapter → file persistence
- 03 ↔ 05: templates, tolerance, validation/test split และ evidence ของผลผิด
- 02 ↔ 04: locate/inspect response จับคู่ job/request id และทิ้งผลเก่าหลัง reset

ทุกคนเขียนเอกสารและผลทดลองส่วนตน คนที่ 5 รวบรวม report และทดสอบรวม
หากแก้ไฟล์เจ้าของอื่นให้ tag ใน Issue/PR และอธิบาย interface ที่เปลี่ยน
ใช้ feature branch เดิมได้ แต่เมื่อเริ่มชิ้นงานใหม่หลัง merge ให้เริ่มจาก develop ล่าสุด
