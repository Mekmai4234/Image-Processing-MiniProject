# Webcam label detection — 24 ตุลาคม 2026

## แก้สาเหตุ

- ตัวตรวจเดิมต้องเห็นขวดเต็มใบบนพื้นหลังเรียบ จึงไม่ทำงานกับภาพห้องจริง/ขวดใกล้กล้อง
- เมื่อ segmentation ไม่ผ่าน ระบบตั้ง sharp_enough=false แล้ว UI แจ้งว่าเบลอ แม้ยังไม่ได้วัดฉลาก
- Locator ย่อเหลือ 480px ทำให้รายละเอียดตัวหนังสือลดลง

## รุ่นใหม่

- จับลวดลาย SIFT และตรวจ homography/ขอบเขตของฉลากบนพื้นหลังทั่วไป ไม่บังคับเห็นทั้งขวด
- ตรวจความคมชัดเฉพาะฉลากที่ปรับ perspective และขนาดแล้ว ใช้เกณฑ์เดียวกับภาพเต็ม
- Locator 640px, จำกัดภาพค้นหาสูงสุด 800px และ cache features ของภาพอ้างอิง
- Auto capture พร้อมเมื่อเห็นฉลากคมชัด แม้ bottle_visible=false; คง latch เมื่อยังมีฉลากเดิมอยู่
- ไม่แสดงคำเตือนเบลอจากการหาขวดไม่พบ; แนะนำให้เห็นฉลากครบและอยู่ในระยะโฟกัส
- PASS reason label_match หมายถึงฉลากตรงภาพอ้างอิง ไม่รับรองตำแหน่งฉลากเทียบขวดทั้งใบ
- score_method reference_sift_inlier_ratio_v1 คืออัตราส่วน feature correspondences ที่ผ่านการตรวจ geometry ไม่ใช่ probability หรือ accuracy
- เกณฑ์ inliers/coverage/correlation และข้อจำกัดอยู่ต้น docs/api-contract.md

## หลักฐาน

- Backend 168 tests + 94 subtests ผ่าน
- Frontend 144 tests พร้อม TypeScript/production build ผ่าน
- Synthetic HTTP regression ครอบคลุมพื้นหลังรก perspective close-up, 480/640px, ฉลากอื่น และฉลากถูกตัด
- ภาพ Webcam ที่ผู้ใช้บันทึกแล้วเคย FAIL: ส่งใหม่ผ่าน API ได้ HTTP 200 / PASS / label_match, score 0.7561, storage saved และภาพกรอบเขียว
- Locator ของภาพเดียวกันพบฉลากที่ขนาด 1280/640/480px
- ไม่ commit ภาพกล้องจริงหรือ reference ส่วนตัว ผล replay นี้ไม่ใช่การทดสอบกล้องสดใหม่หรือการรับรอง accuracy กับขวดอื่น

## ทดลองใช้งาน

เปิด start.cmd หาก Backend ยังไม่ได้รัน จากนั้นรีเฟรชหน้า Webcam เปิดกล้อง หันฉลากเข้ากล้องให้เห็นครบ ถอยพอให้กล้องโฟกัสได้และถือนิ่ง ระบบจะเตรียม Auto capture เมื่อฉลากพร้อม หรือใช้ Capture เพื่อตรวจเอง
