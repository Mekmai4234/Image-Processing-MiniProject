# Vending Vision — Image Processing MiniProject

เว็บตรวจฉลากขวดน้ำไทยด้วย Image Processing พร้อมสายพานคัดแยกจำลอง 3D

เว็บ React + ฉาก Three.js + Webcam + FastAPI/OpenCV + SQLite และไฟล์ภาพในเครื่อง เชื่อมงาน 01–05 แล้ว


## วิธีใช้งานรุ่นปัจจุบัน — สินค้าเดียว / หมุนอัตโนมัติ / PASS–FAIL

1. Settings: ตั้งชื่อสินค้าและภาพอ้างอิงเพียงรายการเดียว กรอบฉลากใช้เป็น template โดยตรง
2. Simulation: อัปโหลดภาพหนึ่งภาพแล้ว Run ฉากหมุนขวด 360° อัตโนมัติ ก่อนส่งภาพเดิมเข้าตรวจ ไม่ต้องเลือกมุม
3. ผลตรวจมี PASS และ FAIL เท่านั้น: ภาพเบลอ ความคล้ายต่ำ ไม่พบขวด/ฉลาก หรือผิดตำแหน่งเป็น FAIL พร้อมเหตุผล ไม่ได้ยืนยันว่าไม่มีฉลากรอบขวด
4. การหมุนจากภาพเดียวเป็นการจำลองทางภาพ ไม่มีหลักฐานเพิ่มจากด้านหลังขวด ส่วน Webcam ผู้ใช้ยังหมุนขวดจริงด้วยมือ
5. ค่า Match เป็น similarity ของ template ไม่ใช่ confidence ที่สอบเทียบ และไม่ใช่ความแม่นยำของชุดทดสอบอิสระ
6. ประวัติ REVIEW รุ่นเก่าแสดงเป็น FAIL ตามเกณฑ์ไม่ปล่อยผ่าน แต่เก็บ snapshot ต้นฉบับในเครื่องไว้สำหรับตรวจสอบย้อนหลัง

## เริ่มใช้งาน

ติดตั้ง Python 3.11+ และ Node.js 22.12+ (พร้อม npm) แล้วเปิด `start.cmd` หรือรัน:

```powershell
.\scripts\start.ps1
```

โปรแกรมจะเตรียม dependencies/build และเปิด Backend ที่ **http://127.0.0.1:8000** ซึ่งให้บริการหน้าเว็บด้วย
เข้า **[Reference setup](http://127.0.0.1:8000/settings)** เลือกภาพขวดเต็มใบหนึ่งสินค้า ตั้งชื่อ และปรับกรอบให้ครอบฉลาก จากนั้นเลือกโหมด API จริงเพื่อใช้ Simulation / Webcam / History

- ภาพอ้างอิงและ config เก็บใน `storage/reference-profile/` และโหลดกลับหลังเปิดโปรแกรมใหม่
- ผลตรวจเก็บเป็นภาพต้นฉบับ ภาพวาดกรอบ `result.json` และ SQLite ใน `STORAGE_ROOT`; ดาวน์โหลด ZIP/CSV ได้จาก History
- ใช้พื้นหลังเรียบ เห็นขวดทั้งใบ แสงคงที่ และฉลากด้านหน้าชัดเจน
- **REFERENCE MODE เป็นเกณฑ์ทดลองจากภาพที่เลือกเอง ไม่ใช่โมเดลที่ผ่าน independent validation**; match score ไม่ใช่ confidence/accuracy
- DEMO แยกจาก API จริงอย่างชัดเจน ไม่เปิดกล้องจริงและไม่อ้างว่าเป็นผลตรวจภาพจริง
- ใช้ [คู่มือเริ่มต้น](docs/getting-started.md), [วิธีทำงานร่วมกัน](CONTRIBUTING.md) และคู่มือ env/step/process ของแต่ละส่วน

## หน้าเว็บเป้าหมาย

| หน้า | ความสามารถ |
|---|---|
| Simulation | อัปโหลดภาพขวดหนึ่งภาพ → หมุนอัตโนมัติ → ตรวจและคัด PASS/FAIL บนสายพาน 3D |
| Webcam | เปิดกล้องโน้ตบุ๊ก → ผู้ใช้หมุนขวดด้วยมือ → พบฉลาก → ถ่ายและตรวจ |
| History | ดูภาพก่อน/หลังวาดกรอบ กรองตามโหมด สินค้า วัน ผลตรวจ และส่งออก CSV |

ทั้งสองโหมดใช้ตัวตรวจเดียวกัน: `PASS` กรอบเขียว, `FAIL` กรอบแดง ภาพที่ตัดสินไม่ได้ถูกคัดเป็น FAIL พร้อมเหตุผล
คะแนน `match_score` เป็นความคล้ายกับต้นแบบ ไม่ใช่โอกาสที่คำตอบถูก

## งาน 01–05

| งาน | คู่มือ | เนื้อหา |
|---|---|---|
| 01 | [Web UI](01_web_ui/step.txt) | หน้าจอทั้ง 3 หน้า การแสดงกรอบและการเรียก API |
| 02 | [Simulation 3D](02_simulation_3d/step.txt) | สายพาน แท่นหมุน ตัวดัน และสถานะการจำลอง |
| 03 | [Image Processing](03_image_processing/step.txt) | หาฉลาก ตรวจชนิด ตำแหน่ง คุณภาพภาพ และคะแนน |
| 04 | [Webcam / Backend / Logging](04_webcam_backend_logging/step.txt) | กล้อง API SQLite และภาพกับ Log ในเครื่อง |
| 05 | [Dataset / Testing](05_dataset_testing/step.txt) | ภาพอ้างอิง Ground truth ชุดทดสอบ และรายงานผล |

## สมาชิกและ GitHub ผู้รับผิดชอบ

| งาน | ส่วนที่รับผิดชอบ | GitHub ผู้ทำ |
|---|---|---|
| 01 | Web UI — Simulation / Webcam / History | [@jirapa-gm](https://github.com/jirapa-gm) |
| 02 | Simulation 3D — สายพาน / หมุนขวด / คัดแยก | [@jakkrich0912-web](https://github.com/jakkrich0912-web) |
| 03 | Image Processing — หาฉลาก / เปรียบเทียบ / รูปทรง | [@Mekmai4234](https://github.com/Mekmai4234) |
| 04 | Webcam / Backend / Logging | [@PhonlakritTH](https://github.com/PhonlakritTH) |
| 05 | Dataset / Testing / Evidence / CI | [@marisa46054](https://github.com/marisa46054) |

ประวัติ commit เดิมของสมาชิกถูกเก็บไว้ใน `main` และ `develop` โดยไม่ squash หรือเปลี่ยนชื่อผู้เขียน Contributors ของ GitHub อัปเดตจาก commit บน default branch และอาจใช้เวลาประมวลผล

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

- `main`: default branch สำหรับรุ่นใช้งานที่ทดสอบแล้ว
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

CI ตรวจโครงสร้างเอกสารร่วมกับ backend/detector/frontend tests และ production build; tests สังเคราะห์ไม่ใช่การประเมิน accuracy กับขวดจริง

## ขอบเขตเริ่มต้นและการเก็บข้อมูล

เริ่มจากสินค้า 2 รุ่น โดยตั้งชื่อและภาพฉลากในหน้า Reference setup; ทีมยังต้องเก็บภาพ validation/test ที่แยกจากภาพอ้างอิงก่อนรายงาน accuracy
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
