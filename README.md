# Vending Vision — Image Processing MiniProject

เว็บตรวจฉลากขวดน้ำไทยด้วย Image Processing พร้อมสายพานคัดแยกจำลอง 3D

> สถานะ: โครงงานและคู่มือพัฒนาสำหรับทีม 5 คน พร้อมต้นแบบ HTML ทดลอง
> ยังไม่มีเว็บ React / Backend / Webcam / ตัวตรวจจริงครบระบบ
> ต้นแบบและภาพออกแบบไม่ใช่หลักฐานความแม่นยำของระบบจริง

## เริ่มตรงนี้

1. อ่าน [ขอบเขตและเกณฑ์รับงาน](docs/scope.md)
2. ดู [การแบ่งงานสมาชิก](docs/team.md) แล้วใส่ชื่อและ GitHub username จริงผ่าน PR
3. อ่าน [คู่มือเริ่มต้น](docs/getting-started.md) และ [วิธีทำงานร่วมกัน](CONTRIBUTING.md)
4. ไปยังโฟลเดอร์งานของตัวเอง อ่าน `env.txt` → `step.txt` → `process.txt`
5. เริ่ม Feature Branch จาก `develop` และเปิด PR กลับเข้า `develop`

## หน้าเว็บเป้าหมาย

| หน้า | ความสามารถ |
|---|---|
| Simulation | อัปโหลดขวดหลายมุม → จำลอง Feed / Orient / Inspect / Sort / Output บนสายพาน 3D |
| Webcam | เปิดกล้องโน้ตบุ๊ก → ผู้ใช้หมุนขวดด้วยมือ → พบฉลาก → ถ่ายและตรวจ |
| History | ดูภาพก่อน/หลังวาดกรอบ กรองตามโหมด สินค้า วัน ผลตรวจ และส่งออก CSV |

ทั้งสองโหมดใช้ตัวตรวจเดียวกัน: `PASS` กรอบเขียว, `FAIL` กรอบแดง,
`REVIEW` สีเหลืองสำหรับภาพที่ตัดสินไม่ได้ โดย REVIEW ไปคัดออก/ถ่ายใหม่ ไม่ปล่อย PASS
คะแนน `match_score` เป็นความคล้ายกับต้นแบบ ไม่ใช่โอกาสที่คำตอบถูก

## งาน 01–05

| งาน | คู่มือ | เนื้อหา |
|---|---|---|
| 01 | [Web UI](01_web_ui/step.txt) | หน้าจอทั้ง 3 หน้า การแสดงกรอบและการเรียก API |
| 02 | [Simulation 3D](02_simulation_3d/step.txt) | สายพาน แท่นหมุน ตัวดัน และสถานะการจำลอง |
| 03 | [Image Processing](03_image_processing/step.txt) | หาฉลาก ตรวจชนิด ตำแหน่ง คุณภาพภาพ และคะแนน |
| 04 | [Webcam / Backend / Logging](04_webcam_backend_logging/step.txt) | กล้อง API SQLite และภาพกับ Log ในเครื่อง |
| 05 | [Dataset / Testing](05_dataset_testing/step.txt) | ภาพอ้างอิง Ground truth ชุดทดสอบ และรายงานผล |

แต่ละโฟลเดอร์มี `env.txt` (เตรียมเครื่อง), `step.txt` (ทำตามลำดับ),
และ `process.txt` (หลักการ Input/Output และการเชื่อมงาน)
โค้ดเว็บทั้งหมดอยู่ร่วมกันที่ `apps/web/`; โค้ดหลังบ้านอยู่ที่ `apps/backend/`
โฟลเดอร์ 01–05 เป็นการแบ่งงาน ไม่ใช่แอปอิสระ 5 ตัว

## โครงสร้าง

```text
01_web_ui/                     คู่มืองานคนที่ 1
02_simulation_3d/              คู่มืองานคนที่ 2
03_image_processing/          คู่มืองานคนที่ 3
04_webcam_backend_logging/    คู่มืองานคนที่ 4
05_dataset_testing/           คู่มืองานคนที่ 5
apps/web/                     เว็บเดียว แบ่ง features ตามเจ้าของงาน
apps/backend/                 API / services / inspection / persistence
docs/                         ขอบเขต สัญญาข้อมูล คู่มือทีม และแผนส่งงาน
examples/                     ตัวอย่าง JSON/CSV สังเคราะห์ ไม่ใช่ผลจริง
datasets/                     วิธีจัดข้อมูล; ภาพจริงและ manifests อยู่ในเครื่อง
storage/                      วิธีเก็บผล; รูปและฐานข้อมูลจริงอยู่ในเครื่อง
prototypes/                   ต้นแบบ HTML เดิมสำหรับอ้างอิงพฤติกรรม
scripts/                      ตัวตรวจโครงสร้างเอกสาร
.github/                      CI และแม่แบบ Issue / PR
```

## Branch และการส่งงาน

- `main`: default branch สำหรับจุดส่งมอบที่ตรวจแล้ว (ขณะนี้เป็นฐานเอกสาร)
- `develop`: รวมการพัฒนารอบปัจจุบัน เริ่มทำงานจาก branch นี้
- `feature/...`: งานย่อยแต่ละคน → PR เข้า `develop`
- เมื่อผ่านเกณฑ์รอบส่งมอบ: PR `develop` → `main`
- `main` / `develop` ต้องมี PR, ผู้ตรวจอนุมัติ 1 คน และ check `repository-check` ผ่าน
- ใช้ Issues 01–05 เป็นรายการหลัก แยกงานย่อยและระบุผู้รับผิดชอบจริงก่อนเริ่ม

## ทดลองต้นแบบที่มีอยู่

เปิด `prototypes/conveyor-demo.html` ด้วยเบราว์เซอร์บนเครื่อง
เป็น SVG มุมมอง perspective กับภาพเคลื่อนไหวและเกณฑ์สีพื้นฐาน
ยังไม่ใช่ฉาก Three.js, ไม่มี Webcam, ไม่มีการเขียนภาพลงโฟลเดอร์อัตโนมัติ
ตัวตัดพื้นหลังเดิมเหมาะกับพื้นหลังเรียบ และต้องทดสอบเพิ่มกับขวดใส

## ตรวจ Repository โดยไม่ต้องติดตั้งเว็บ

```powershell
py -3 scripts/check_repository.py
```

CI นี้ตรวจโครงสร้าง คู่มือ ตัวอย่างข้อมูล และลิงก์เอกสารภายใน
ยังไม่ใช่การทดสอบ accuracy หรือแอปที่ยังไม่พัฒนา

## ขอบเขตเริ่มต้นและการเก็บข้อมูล

เริ่มขวดไทย 2 ยี่ห้อ ยี่ห้อละ 1 รุ่น/ขนาด โดยทีมระบุของจริงใน product catalog
ใช้รหัสชั่วคราว `bottle_a` / `bottle_b` จนกว่าจะเลือกสินค้า
เก็บข้อมูลจริงและภาพ Webcam ในเครื่องที่รัน Backend ตาม `STORAGE_ROOT`
ถ้าจะโฮสต์ Backend บน server ไฟล์จะอยู่บน server ต้องออกแบบการดาวน์โหลดเพิ่ม
Public repository ไม่ได้ทำให้เพื่อนเขียนโค้ดได้ทันที ต้องรับคำเชิญ Collaborator
ดู [วิธีเชิญสมาชิก](docs/github-setup.md)

## เอกสารสำคัญ

- [Issues 01–05 และ Milestones](docs/work-board.md)

- [ตำแหน่ง .env และ config ร่วม](docs/configuration.md)
- [Architecture และ state flow](docs/architecture.md)
- [API contract และตัวอย่างผล](docs/api-contract.md)
- [Dataset guide](docs/dataset-guide.md)
- [ที่เก็บภาพและ Log](docs/storage-guide.md)
- [แผนรอบส่งงาน](docs/milestones.md)
- [วิธีทดสอบและเกณฑ์ผ่าน](docs/testing-plan.md)
- [สถานะ implementation](docs/implementation-status.md)

Repository นี้เป็นงาน Vending Vision ของทีม ใช้เพียงรูปแบบแบ่งเอกสาร env/step/process
จากตัวอย่างการจัดงาน ไม่ได้คัดลอกเนื้อหาวิชา Agentic AI หรือสไลด์ของอาจารย์
