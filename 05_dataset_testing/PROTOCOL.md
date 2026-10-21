# ข้อตกลงการเก็บข้อมูลและหลักฐานของ 05

สถานะ 21 ตุลาคม 2026: เจ้าของงานยืนยันว่ายังไม่มีชุดภาพจริงและ PNG ต้นแบบ จึงยังไม่มีผล accuracy, final-test report หรือ visual approval ของโครงการ

## Pilot ก่อนเปิดชุดจริง

ใช้ [pilot-plan.csv](templates/pilot-plan.csv): 2 สินค้าชั่วคราว × 3 กลุ่มอิสระต่อสินค้า × 6 conditions × 5 ภาพ = **เป้าหมาย 180 ภาพ** ทุกแถวยัง not_started จำนวนจริงและ reviewer ยังว่าง ไม่ใช่ manifest ของภาพที่ถ่ายแล้ว

สินค้า bottle_a/bottle_b ยังต้องเลือกยี่ห้อ รุ่น และขนาดจริงกับเจ้าของโครงการ/03 แต่ละสินค้ามีกลุ่ม development/validation/test ของตัวเอง ใช้ขวดและ session คนละชุดตั้งแต่ต้น ถ้าขวดเดียวข้าม session หรือ session เดียวถ่ายหลายขวด ต้องรวม connected component ทั้งหมดก่อนแบ่ง ห้ามฝืนตัดกลุ่มเพื่อให้เปอร์เซ็นต์พอดี

แผนขั้นต่ำนี้ได้สัดส่วนกลุ่ม 1/1/1 ต่อสินค้า จึงยังไม่ใช่ 60/20/20 หากต้องการ 60/20/20 ให้เพิ่มกลุ่มอิสระ ไม่ย้ายภาพบางส่วนออกจากกลุ่มเดิม ควรเพิ่มหลายขวดในแต่ละกลุ่มเมื่อทำได้และรายงานจำนวนขวดจริง ไม่ถือ 180 ภาพจากขวดน้อยใบเป็นตัวอย่างอิสระ 180 ตัวอย่าง

Conditions: good, wrong_label, misplaced/tilted, rear/hidden, blur และ occlusion/unknown แยกเงื่อนไขย่อยใน provenance เมื่อถ่ายจริง ระบุสภาพแสง พื้นหลัง ระยะ รุ่นกล้อง ความละเอียด วัน/เวลารอบถ่าย ผู้ถ่าย สิทธิ์ภาพ และ hash ทุกภาพ ให้ผู้ตรวจที่สองทวนเคสกำกวม

ก่อนถ่ายจริงให้ตกลง normalized ROI/tolerance/มุมเอียงกับ 03 บันทึก revision ของกฎ กำหนดเกณฑ์คุณภาพและเป้าหมายยอมรับบน validation ก่อนเปิด final test ห้ามใช้จำนวนภาพเริ่มต้นเป็นคำรับรองความแม่นยำ

## Ground truth และ references

03 ปัจจุบันใช้ลำดับ quality → known identity → position ใน `apps/backend/app/inspection/pipeline.py` ดังนั้นเมื่อมองเห็นชัดและรู้ว่าฉลากต่างจาก expected ให้ wrong_label เป็นเหตุผลหลักแม้ตำแหน่งผิดด้วย 05 ปฏิเสธ manifest ที่ทราบฉลากผิดชนิดแต่ให้ reason=misplaced_label โดยไม่เปลี่ยนคำตอบอัตโนมัติ บันทึกปัญหาตำแหน่งเพิ่มเติมใน position_ok/metadata และให้ 03/05 ทวนกฎกับภาพ pilot ก่อนรับรอง dataset

misplaced_label ต้องมี label_present=yes, visible_enough=yes, position_ok=no ส่วน label_product ที่อ่านไม่ได้และ precedence เคสกำกวมยังต้องทวน ห้ามตีความ unknown ว่า no ภาพด้านหลังหนึ่งภาพไม่ยืนยัน missing_label ไม่ใส่ GT FAIL/missing_label จริงจนมี required-view protocol ที่ validate และ Backend ประเมินได้

แบ่งกลุ่มก่อนเลือก references; references ทุกภาพต้อง trace ไป development รวมภาพต้นทางของ crop/resize/augmentation ตรวจ near duplicates ด้วยคนเพิ่มเติมจาก dHash สร้าง audit/hash ใหม่ทุกครั้งที่ manifest/catalog/provenance เปลี่ยน เก็บ final test พร้อมคำตอบแยกจากทีมปรับ threshold และล็อก version ก่อนประเมิน

## Single-view evaluation v1

หน่วยคือ `(image_id, expected_product)` หนึ่ง inspection ต่อภาพหลัก ภาพเดิมต่าง expected อยู่ split เดียวเสมอ รายงานทั้งจำนวนภาพไม่ซ้ำและจำนวนกรณีตรวจ แยกไฟล์ predictions/run ของ simulation และ webcam และไม่รวม DEMO ใน metrics จริง

ส่งให้ detector/HTTP เฉพาะ pixels, expected_product, source_mode, UUID และมุมที่รู้จริง ไม่ส่ง result/reason, reviewer, split, filename เฉลย หรือข้อมูล GT อื่นเป็น features เก็บ raw HTTP response ก่อน import อย่าประกอบ prediction จากคำตอบมนุษย์

ใช้ `import_predictions.py` แปลง receipt JSONL เป็น CSV โดยหนึ่งบรรทัดมี:

```json
{"protocol":"single_view","image_id":"รหัสภาพจริง","expected_product":"สินค้าใน catalog","source_mode":"webcam","config_version":"รุ่นที่ล็อก","response":{}}
```

`response` ต้องเป็น payload ของ API จริง มี demo=false, IDs, evidence.kind=single_view, result/reason และ timing_ms ที่วัดจริง ไม่ใช่ object ว่างตามโครงสร้างข้างบน Operational error ให้เก็บ error response พร้อม context ของรอบนั้น; ตัวนำเข้าไม่เติม PASS ให้รายการที่ขาด และปฏิเสธ DEMO, mode/config ปนกัน, ID ซ้ำ และ multi-view ที่ปลอมเป็น single-view

สำหรับ single_view ต้องมี supporting_images=[] และ supporting_angles_deg=[] พร้อม verified_coverage=false และไม่มี required_view_profile ที่อ้างว่าครบด้าน หาก evidence หรือ timing_ms ไม่ใช่ object เครื่องมือปฏิเสธด้วย error ที่ระบุสาเหตุ ไม่ปล่อยข้อมูลขัดกันเข้าประเมิน

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/import_predictions.py --receipts datasets/manifests/webcam-http.jsonl --output datasets/manifests/webcam-predictions.csv
```

เก็บ receipt file hash ที่เครื่องมือพิมพ์ และ run metadata ที่มี commit/config/dataset/manifest/catalog/provenance hashes, เครื่องและความละเอียด แล้วใช้ evaluate.py ตาม README การ import ผ่านหมายถึงรูปแบบสอดคล้องเท่านั้น ไม่พิสูจน์ความแท้ของ HTTP receipt ต้องตรวจ provenance โดยผู้ประเมิน

ผลสินค้าไม่เปลี่ยนเพราะ storage ล้มเหลว หาก API ส่งผลตรวจสำเร็จพร้อม storage_status=failed ยังนับผลเดิม ส่วน error ที่ไม่มี product decision แยกจำนวนและ GT denominator โดยชัดเจน เวลาใน metrics มาจาก timing_ms ของ Backend ไม่รวม animation/network/การหมุนด้วยมือ

## Multi-view protocol — ยังไม่เปิด final metrics

หนึ่ง job คือขวดใบเดียวใน session เดียว มี main image และ supporting images ที่รู้มุมจริงหรือตั้ง null เก็บลำดับ input, job/request/inspection IDs, locator responses, มุมที่เลือก, evidence และทุก supporting image ที่ส่ง Backend

ผลของ job ไม่เท่ากับผลของแต่ละมุมอิสระ ต้องตกลง job_id/main-image mapping และ GT ของ job กับ 03/02/04 ก่อนเพิ่ม evaluator สำหรับ multi-view ปัจจุบัน importer ปฏิเสธ multi_view เพื่อไม่ให้รายงาน single-view เกินจริง ทดสอบ ORIENT/wait/reset/stale response แยกตาม integration checklist เมื่อฉากเชื่อมพร้อม ยังไม่มี profile ที่รับรอง missing_label

## หลักฐาน integration และหน้าตา

[integration-checklist.csv](integration-checklist.csv) แยก data_kind=synthetic/real/browser/hardware/visual พร้อม test_date, commit, tester, evidence, evidence_sha256 และ notes สถานะ passed/failed ต้องมีไฟล์หลักฐานตรวจ hash ได้; blocked ต้องมีเหตุผล ห้ามยก smoke pass ไปเป็น real/hardware pass

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/evidence.py --checklist 05_dataset_testing/integration-checklist.csv
```

เพิ่ม `--summary path/to/new-status.json` เพื่อบันทึกจำนวนสถานะ/ชนิดข้อมูลและ case IDs ที่ค้าง หรือใช้ `--require-complete` เพื่อให้คำสั่ง fail เมื่อยังไม่ครบทุกเคสและยังไม่มี passed evidence ครบ real/browser/hardware/visual สถานะ records_consistent แยกจาก ready_for_acceptance; ต้องมี human review ก่อนรับงานจริงแม้ metadata ครบ

ภาพใน [reports/browser](reports/browser) เป็น screenshot เว็บจริงที่ใช้ DEMO ไม่ใช่ภาพขวดจริง และไม่ใช่ reference mockup แต่ละหน้าถ่ายที่ 1586×992, 1366×768 และจอเล็ก 390×844 ข้อบกพร่องที่ตรวจพบอยู่ใน [DEFECTS.md](DEFECTS.md) ต้องให้เจ้าของ 01–04 แก้และตรวจซ้ำ

ขนาดข้างต้นคือ CSS viewport ที่ร้องขอ Browser provider บันทึก PNG เล็กกว่า viewport ที่ร้องขอ (เช่น 1571×982 สำหรับ CSS 1586×992) เก็บทั้งสองค่าและ hash ใน [captures.json](reports/browser/captures.json) โดยไม่ resize ภาพเพื่อทำให้ดูเหมือนตรงต้นแบบ ต้อง capture ให้ขนาด pixel ตรง reference ก่อนใช้ diff เครื่องมือจะปฏิเสธภาพคนละขนาด

เมื่อได้รับ PNG ต้นแบบที่อนุญาตใช้แล้ว จึงสร้าง side-by-side และ diff ด้วย compare_screenshots.py ที่ viewport ตรงกัน ห้ามใช้ screenshot ของเว็บเองเป็น reference แล้วอ้างว่าเทียบต้นแบบผ่าน Mask ต้องระบุ rect=[x,y,width,height] และ reason=timestamp/id/animation เท่านั้น รายงานจำนวน masked pixels และไม่อนุญาต mask ทั้งภาพ ตัวเลข diff เป็นหลักฐานประกอบ ไม่ auto approve หน้าตา

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/compare_screenshots.py --actual path/to/actual.png --reference path/to/reference.png --report path/to/comparison.json --side-by-side path/to/side.png --diff path/to/diff.png
```

## CI ที่รันซ้ำได้

Workflow ใหม่ `.github/workflows/05-testing.yml` เป็น gate ของ 05 แยกจาก workflow กลางเดิม ไม่แก้แอปหรือ package/lock ของสมาชิกอื่น รัน dataset/repository tests บน Python 3.11/3.12, backend รวม detector/HTTP smoke บน Python 3.11 ด้วย [requirements-smoke.txt](requirements-smoke.txt), frontend ใช้ package-lock และ Node ตาม engines พร้อม tests/build

run_checks.py ตรวจจำนวน tests และ fail เมื่อไม่พบ tests, มี failure/error/skip หรือขาด dependencies ไม่ใช้ skip ทั้งหมดให้ CI เขียว รายงานเก็บ command scopes, dependency versions, commit, dirty-worktree flag และ source file hashes แยกจาก real-data/hardware/visual approval ข้อมูลจริงและ runtime storage ไม่ถูกส่งเข้า Git

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -m pip install -r 05_dataset_testing/requirements-smoke.txt
npm ci --prefix apps/web
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/run_checks.py --suite all --report path/to/new-smoke-report.json
```

เจ้าของ repo ยังต้องรับรอง workflow และตั้ง required checks หากต้องการบังคับก่อน merge การเพิ่ม job ไม่ได้เปลี่ยน branch protection เอง
