# ข้อพบจาก browser smoke — 21 ตุลาคม 2026

ฐานที่ตรวจ: commit 2569e7ced6e1f4fc788791ab0530b10faea2ace4 พร้อมเครื่องมือใหม่ของ 05 ใน working tree ใช้ Vite local และ DEMO; ไม่เปิดกล้องจริง ไม่เรียก detector ด้วยภาพจริง ไม่เปลี่ยน implementation ของเจ้าของส่วน

## 05-BR-01 — Simulation ยังไม่ประกอบฉาก 3D

เจ้าของแก้: 01/02 จุดเชื่อม `pages/slots.ts` และ SimulationPage

วิธีทำซ้ำ: เปิด /simulation → DEMO → ใช้ชุดภาพตัวอย่าง → ตรวจชุดภาพนี้ ผล DEMO คืน PASS และนับ 1 ครั้ง แต่พื้นที่ฉากแสดงข้อความรอคอมโพเนนต์ 02 แทนเครื่องจักรเคลื่อนไหว การมี state machine/scene tests ผ่านจึงยังไม่ยืนยันว่า scene ถูกประกอบใน page

หลักฐาน: [screenshot](reports/browser/simulation-1586x992.png), [snapshot หลังตรวจ DEMO](reports/browser/simulation-state.txt)

เกณฑ์แก้: mount controller/scene จริงครั้งเดียว เห็น feed/rotate/wait/sort/output ตาม job ที่ตรงกับ API และมีวิดีโอหรือ browser evidence ห้ามมีการตรวจซ้ำจาก page และ scene

## 05-BR-02 — ชื่อสินค้า Webcam ต่างจาก catalog กลาง

เจ้าของแก้: 01/04

วิธีทำซ้ำ: DEMO → Webcam จะเห็นปุ่มชื่อสิงห์/คริสตัล 600ml ขณะที่ catalog ของ shell ยังเป็น Bottle A/B รอเลือกยี่ห้อ/รุ่นจริง ยังไม่มีข้อมูลจริงยืนยันชื่อสินค้าเหล่านี้ ไม่ควรใช้ชื่อคงที่เป็นหลักฐานว่า config พร้อม

หลักฐาน: [screenshot](reports/browser/webcam-1586x992.png), [snapshot](reports/browser/webcam-state.txt)

เกณฑ์แก้: selector และ expected/detected ใช้ catalog เดียวกับ backend/source ที่เลือก แสดงสถานะยังไม่พร้อมอย่างถูกต้อง และมี tests ของการเปลี่ยนสินค้า/source ระหว่าง pending

## 05-BR-03 — History จอเล็กมี horizontal overflow ระดับเอกสาร

เจ้าของแก้: 01

วิธีทำซ้ำ: DEMO → History → viewport 390×844 เอกสารกว้าง 475px แม้ viewport กว้าง 390px รายละเอียดการตรวจเบียด/ทับพื้นที่ตาราง มีแถบเลื่อนแนวนอนระดับหน้าแทนให้ตารางเลื่อนในพื้นที่ของตัวเอง

หลักฐาน: [screenshot](reports/browser/history-390x844.png), [DOM measurements](reports/browser/viewport-measurements.json)

เกณฑ์แก้: mobile เรียงคอลัมน์ลงล่าง ตาราง scroll ภายใน container ปุ่ม/รายละเอียดไม่ทับกัน และ document.scrollWidth ไม่เกิน viewport (เผื่อ scrollbar) ทดสอบซ้ำทั้ง desktop และจอเล็ก

## ส่วนที่ผ่านในขอบเขต browser smoke

- navigation เปิดทั้งสามหน้าได้ และ banner DEMO แยกจากผลจริง
- กดตรวจชุดภาพ DEMO ได้ PASS แล้วพบรายการใหม่ใน History DEMO (จาก 4 เป็น 5 รายการ) รายละเอียดแสดงโหมด Simulation/result/score สอดคล้องกัน
- Desktop ที่วัดไม่มี document overflow ตาม viewport-measurements แต่ยังไม่ได้เทียบ layout กับ PNG ต้นแบบ

## สิ่งที่ยังรับรองไม่ได้

ไม่มี reference PNG ตามที่ผู้ใช้ยืนยัน จึงไม่มี screenshot diff หรือ visual acceptance ไม่มี permission/device-loss/native capture/auto capture ของกล้องจริง ไม่มี final dataset metrics ไม่เปลี่ยนเคสเหล่านี้เป็น passed จาก smoke tests

รายการนี้เก็บใน PR งาน 05 เพื่อให้ทีม review ไม่ได้เปิด Issue หรือส่งข้อความถึงสมาชิกอัตโนมัติ
