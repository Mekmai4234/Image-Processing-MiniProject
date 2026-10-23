# ทีมและการแบ่งงาน

ชื่อโครงการ: Vending Vision; Repository: Image-Processing-MiniProject
เจ้าของ Repository: @Mekmai4234 (ยังไม่ถือว่าเป็นคนที่ 1 โดยอัตโนมัติ)
บัญชีผู้รับผิดชอบยืนยันจากผู้เขียน PR และ commit ของงานแต่ละส่วน

| งาน | ชื่อจริง | GitHub username | ขอบเขต | Branch | ความยาก |
|---|---|---|---|---|---|
| 01 | jirapa-gm | [@jirapa-gm](https://github.com/jirapa-gm) | UI/UX, 3 หน้า, overlay, API client | feature/01-web-ui | 3/5 |
| 02 | JAKKRICH | [@jakkrich0912-web](https://github.com/jakkrich0912-web) | Three.js, conveyor, orient, reject | feature/02-simulation-3d | 4/5 |
| 03 | Mekmai Jankeaw | [@Mekmai4234](https://github.com/Mekmai4234) | locate/classify/position/score | feature/03-image-processing | 5/5 |
| 04 | Phonlakrit Somsong | [@PhonlakritTH](https://github.com/PhonlakritTH) | Webcam, FastAPI, files, SQLite | feature/04-webcam-backend | 4/5 |
| 05 | Marisa Pimpralab | [@marisa46054](https://github.com/marisa46054) | dataset, ground truth, evaluation | feature/05-dataset-testing | 4/5 |

## จุดเชื่อม

- 01 ↔ 02: Scene component, event/state และ stop เมื่อออกหน้า
- 01 ↔ 04: CameraPanel, API client, original image dimensions และภาพ annotated
- 03 ↔ 04: pure inspection function → HTTP/JSON adapter → file persistence
- 03 ↔ 05: templates, tolerance, validation/test split และ evidence ของผลผิด
- 02 ↔ 04: locate/inspect response จับคู่ job/request id และทิ้งผลเก่าหลัง reset

ทุกคนเขียนเอกสารและผลทดลองส่วนตน คนที่ 5 รวบรวม report และทดสอบรวม
หากแก้ไฟล์เจ้าของอื่นให้ tag ใน Issue/PR และอธิบาย interface ที่เปลี่ยน
ใช้ feature branch เดิมได้ แต่เมื่อเริ่มชิ้นงานใหม่หลัง merge ให้เริ่มจาก develop ล่าสุด

## เจ้าของไฟล์ร่วมและผู้ช่วยตรวจ

| พื้นที่ร่วม | เจ้าของการรวม | ผู้ร่วมตรวจเมื่อเปลี่ยน |
|---|---|---|
| apps/web/package*.json, Vite config, routes, shared types/API client | 01 | 02/04 และ 03 เมื่อ schema เปลี่ยน |
| docs/api-contract.md และ examples/ | 04 ประสาน contract | 01/02/03/05 ที่ใช้ข้อมูล |
| apps/backend/requirements และ lock/config | 04 | 03; 05 ทวนว่ารันซ้ำได้ |
| templates, product config, threshold version | 03 | 05 ตรวจข้อมูลและผล validation |
| dataset manifest/split และรายงาน | 05 | 03 ตรวจเกณฑ์; อีกคนทวน ground truth |
| .github/workflows และ scripts/check_repository.py | 05 ดูแล gate | เจ้าของ repo + งานที่กระทบ |

เจ้าของการรวมไม่ได้ห้ามเพื่อนแก้ไฟล์ แต่ต้องประสานก่อน PR ที่กระทบหลายคน
คู่ review ที่แนะนำ: 01↔04, 02↔01, 03↔05; ขอผู้ตรวจเพิ่มตาม interface ที่เปลี่ยน

## ลำดับเริ่มที่ทำพร้อมกันได้

1. ทุกคนตกลงสินค้า 2 รุ่น, contract v0.2 และเกณฑ์รับภาพกับ 03/05
2. 01 สร้าง shell/หน้าว่างและ mock client; 04 สร้าง config/health/products;
   03 เริ่ม pure functions ด้วยภาพ development; 05 เริ่ม manifest และการถ่ายแยกกลุ่ม
3. 02 เริ่ม geometry/state ด้วย mock contract แล้วรวม app shell ของ 01
4. เชื่อม upload → inspect → save → History ให้ครบก่อนขยาย Webcam/หลายมุม
5. เชื่อม locator/scene/Webcam และทดสอบข้อผิดพลาดก่อนแต่งรายละเอียด

04 มีงานหลายด้าน ให้ 01 รับหน้า Webcam/History/overlay และ 03 รับ annotation pixels;
04 เน้น camera lifecycle, API adapter และ persistence ไม่แบก UI/algorithm ทั้งหมด
ไม่มีงานใดเสร็จเพียงเพราะ CI ตรวจเอกสารผ่าน ทุกส่วนต้องมีหลักฐานตาม testing-plan
