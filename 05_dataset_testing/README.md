# งาน 05 — Dataset และ Testing

อัปเดต 22 ตุลาคม 2026: PR #20 merge แล้ว ตรวจฐานรวมล่าสุดและเก็บ browser evidence ใหม่ ดู [รายงานหลัง merge](POSTMERGE-2026-10-22.md) รอบนี้พบ Backend date assertions ไม่ผ่าน 3 cases และ browser defects เดิมยังอยู่ จึงยังไม่ผ่าน acceptance ดู [สถานะล่าสุด](reports/acceptance-status-2026-10-22.json) แทนการใช้ผล smoke เก่ารับรอง commit ใหม่

สถานะ 21 ตุลาคม 2026: มีเครื่องมือ offline, smoke gates และ browser evidence ของแอปจริงด้วยข้อมูล DEMO แล้ว ยังไม่มีภาพขวดจริง/สินค้าและ tolerance ที่ทีมยืนยัน หรือภาพต้นแบบสำหรับ visual comparison งานรอบนี้อยู่ในโฟลเดอร์ 05 และ workflow ใหม่ของ 05 โดยไม่แก้แอป 01–04 ดู [protocol และสถานะงาน](PROTOCOL.md), [ผลทดสอบ](TEST-REPORT.md) และ [defects ที่ต้องส่งต่อเจ้าของ](DEFECTS.md)

## เตรียมเครื่องและทดสอบ

ดู [สถานะตามใบงาน 05-A ถึง 05-E](STATUS.md) และ [สรุปหลักฐานที่ยังไม่ครบ](reports/acceptance-status-2026-10-21.json) แยกจากผล smoke tests การตรวจ records ผ่านไม่ได้แปลว่าระบบผ่าน real-data/hardware/visual acceptance

รันจาก repository root บน PowerShell:

```powershell
py -3 -m venv 05_dataset_testing/.venv
.\05_dataset_testing\.venv\Scripts\python.exe -m pip install -r 05_dataset_testing/requirements.txt
.\05_dataset_testing\.venv\Scripts\python.exe -B -m unittest discover -s 05_dataset_testing -p 'test_*.py' -v
```

เครื่องมือแยกจาก Backend ไม่ต้องติดตั้ง FastAPI หรือ OpenCV และไม่อ่าน/เขียน storage ของระบบ ใช้ Python 3.11+ และ Pillow 12.x รุ่นที่ทดสอบจริงระบุใน [รายงานทดสอบ](TEST-REPORT.md)

## ลำดับทำงาน

1. ยืนยันยี่ห้อ รุ่น ขนาด และ product_id สองรายการกับ 03 รวม tolerance และวิธีให้คำตอบก่อนถ่ายจริง ตัวเลขในคู่มือเดิมยังไม่ใช่ค่าที่ validate แล้ว
2. เริ่มจาก [pilot-plan.csv](templates/pilot-plan.csv) เป้าหมาย 180 ภาพและอย่างน้อย 3 กลุ่มอิสระต่อสินค้า หรือขยายด้วย [capture-plan.csv](templates/capture-plan.csv) ให้ครอบคลุมข้อมูลจริงก่อนถ่าย แผน 180 ภาพขั้นต่ำมี 1/1/1 กลุ่มต่อ split ของแต่ละสินค้า ไม่ใช่ 60/20/20 และไม่รับรองความแม่นยำ ถ้าต้องการ 60/20/20 ให้เพิ่มกลุ่มอิสระ
3. ถ่ายชุดนำร่อง ทวนคำตอบและความครอบคลุมกับ 03 ก่อนเพิ่มจำนวนประมาณ 200 ภาพ เก็บสภาพแสง/ระยะ/ความละเอียด/อุปกรณ์จริง ไม่เดามุมจากการหมุนด้วยมือ
4. เก็บภาพและ manifest ใน `datasets/` ที่ถูก ignore ใช้ [manifest.csv](templates/manifest.csv) เป็น header ขยายจาก contract ด้วย `source_image_id` สำหรับภาพ crop/resize/augmentation ถ้าไม่มีให้ว่าง รหัสนี้อ้างภาพต้นทางใน manifest เดียวกัน ภาพที่เปลี่ยน expected_product ใช้ image_id เดิมแต่เป็นอีกกรณีตรวจ
5. ให้มนุษย์ตรวจคำตอบ แยก GT จาก predictions ผู้ตรวจที่สองตรวจเคสกำกวมและบันทึกชื่อ/ข้อยุติในบันทึก dataset ไม่คัดลอกคำตอบโปรแกรมมาเป็น GT
6. ทำ provenance และ catalog จริง ตรวจไฟล์/hash/กลุ่ม แล้วแบ่ง development/validation/test ทั้งกลุ่มเชื่อมโยงด้วยขวด **หรือ** session รวมภาพดัดแปลงและ hash ซ้ำ **แบ่ง split ก่อนเลือก templates/references** ระหว่างเตรียม proposal ให้ reference_paths ว่างได้ แต่ข้อมูลยังไม่พร้อม evaluation
7. ทวนข้อเสนอและความครอบคลุม แล้วเลือก references จาก development ที่ได้จริง ตรวจ manifest/catalog/provenance ชุดสุดท้ายและสร้าง audit/hash ใหม่ก่อนส่ง development/reference ให้ 03 ผ่านช่องทางแชร์ที่ตกลง เก็บ final test และคำตอบให้ผู้ประเมินถือไว้ บันทึก dataset/config/commit version
8. ทดสอบรวมตาม [checklist](integration-checklist.csv) เมื่อ implementation พร้อม ใช้ test DB และ temporary storage ห้ามเชื่อม fixture กับข้อมูลผู้ใช้ บันทึก DEMO/mock แยกผลจริง และแจ้ง defect ให้เจ้าของส่วนแก้
9. เลือก threshold ด้วย validation จากนั้น lock config และ dataset ก่อน final test หากนำผล test ไปปรับระบบ ต้องเปิดเผยและใช้ชุดใหม่สำหรับผลยืนยันรอบถัดไป

## Provenance ที่ต้องกรอก

คัดลอก [provenance.json](templates/provenance.json) ไปข้อมูล local แล้วเพิ่ม assets ตาม image_id เช่นโครงสร้างด้านล่าง ค่า SHA-256 และข้อความต้องมาจากข้อมูลจริง:

```json
{
  "dataset_version": "your-version",
  "split_locked": false,
  "assets": {
    "your-image-id": {
      "source": "ผู้ถ่าย/รอบถ่าย/กล้องและความละเอียดจริง",
      "rights": "สิทธิ์ใช้และเผยแพร่ที่ยืนยันแล้ว",
      "condition": "normal",
      "synthetic": false,
      "sha256": "SHA-256 ของไฟล์จริง"
    }
  },
  "near_duplicate_reviews": []
}
```

ใช้ `Get-FileHash -Algorithm SHA256 <path>` แล้วแปลง digest เป็นตัวพิมพ์เล็ก condition เป็นชื่อสภาพภาพที่ทีมตกลง เช่น normal/shifted/blurred/back/glare/occluded/wrong_label กำหนดให้คงที่เพื่อเทียบรายงานได้

กรณี `missing_label` ต้องเพิ่ม `missing_label_evidence` ภายใต้ asset ประกอบด้วย `profile`, `validation_record`, `reviewer`, `supporting_image_ids` (array ของ image_id ขวดเดียว/session เดียว/split เดียว) เครื่องมือตรวจความครบของบันทึกและไฟล์เท่านั้น **ไม่ได้ยืนยัน coverage จาก pixels** ต้องให้ 03/05 ทวน profile กับหลักฐานจริง และทดสอบ backend แยกก่อนอ้างผลนี้ ภาพหันหลังเพียงภาพเดียวใช้ REVIEW/label_not_visible

กรณี `FAIL/misplaced_label` ต้องมี `label_present=yes`, `visible_enough=yes` และ `position_ok=no` ครบทั้งสามข้อ หากไม่ครบ เครื่องมือแจ้ง error พร้อมบรรทัดและ field และไม่ให้ผ่าน evaluation โดยไม่แก้ manifest ให้เอง ให้ผู้ตรวจทวนภาพแล้วแก้ข้อมูล

`label_product` หมายถึงสินค้าที่ฉลากระบุ แยกจากตัวขวดและ expected product โมดูล 03 ปัจจุบันกำหนด quality → known identity → position อย่างชัดเจน ดังนั้นกรณี label_product ที่ทราบต่างจาก expected ต้องใช้ wrong_label เป็นเหตุผลหลักแม้ตำแหน่งผิดด้วย validator ปฏิเสธกรณีที่ขัดกับลำดับนี้โดยไม่แก้ GT เอง กฎของกรณี label_product ไม่ทราบยังต้องทวนกับ 03/05 ก่อนรับ dataset จริง

Catalog ใช้รูปแบบเดียวกับตัวอย่างร่วมของทีม แต่ต้องกรอก brand/size_ml/display_name และ `demo=false`, `config_version`, `reference_paths` ของจริง ไม่ใช้ catalog สังเคราะห์ประเมินผล การมี reference ไม่ได้แปลว่า detector ผ่าน validation

## ตรวจข้อมูลจริง

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/dataset_tools.py --root datasets --manifest datasets/manifests/labels.csv --catalog datasets/config/products.json --provenance datasets/manifests/provenance.json --report datasets/manifests/audit-v1.json
```

Report มี hash ของ manifest/catalog/provenance, image SHA-256, ขนาดหลังแก้ EXIF, จำนวนภาพ/กรณีตรวจ/ขวด/session/กลุ่ม ต่อ split และจำนวนต่อสินค้า/condition/result ตรวจ path ไม่ให้หลุด dataset root ตรวจภาพเปิดได้ รหัส/enum/มุม/คำตอบขัดกัน รวมกลุ่มแบบ transitive closure และตรวจ exact duplicate

dHash ใช้ค้นหาคู่ภาพคล้ายเพื่อให้คนทวน เป็น heuristic ที่อาจพลาด crop/การเปลี่ยนแสงและอาจแจ้งภาพต่างกัน ต้องตรวจต้นทางและภาพดัดแปลงด้วยตนเอง หากเป็นภาพเดียวกันให้แก้ provenance/กลุ่มและแบ่งใหม่ก่อน lock หากเป็นคนละภาพจริง เพิ่ม `near_duplicate_reviews` เป็น object ที่มี `filenames` สองรายการ, `sha256` สองค่าเรียงตรง filename, `decision="distinct"`, `reviewer`, `note` โดยผลตรวจจะยังไม่พร้อมจนคู่ที่ค้างถูกจัดการ

Exit code: 0 พร้อมตาม gate ของเครื่องมือ, 1 พบข้อผิดพลาด/ภาพคล้ายค้าง/ยังไม่มี references, 2 input อ่านไม่ได้หรือเขียน report ไม่ได้ ทุกคำสั่งเขียนเฉพาะ output ใหม่ ไม่ทับไฟล์เดิม ไม่มีการแก้ ground truth อัตโนมัติ Gate นี้ไม่รับรองความถูกต้องของคำตอบมนุษย์หรือความครอบคลุมเชิงสถิติ

เพิ่ม `--propose-splits datasets/splits/proposal-v1.csv --seed 5` เพื่อเขียนข้อเสนอใหม่หลังแก้ข้อผิดพลาดข้อมูลแล้ว ไม่แก้ manifest ต้นฉบับ และไม่ย้ายไฟล์ภาพ ใช้ workflow แนวทาง A ตามลำดับนี้:

1. ขณะ `split_locked=false` เตรียมกลุ่มข้อมูลแล้วเสนอ split ก่อนเลือก references; ปล่อย reference_paths ว่างได้ เครื่องมือยังสร้าง proposal ได้ แต่ exit code เป็น 1 เพราะ dataset ต้นฉบับยังไม่พร้อม evaluation
2. ทวน coverage แต่ละสินค้า/condition และนำ proposal ไปเป็น manifest รุ่นใหม่ด้วยตนเอง Proposal ไม่ตรึง references เดิมไว้ หากมี references อยู่แล้ว กลุ่มของภาพเหล่านั้นอาจย้ายไป validation/test ต้องเลือกใหม่จาก development หลังแบ่งกลุ่ม
3. กำหนด reference_paths จาก development ใน manifest ใหม่ทั้งหมด แล้วตรวจใหม่ หาก reference เดิมอยู่ validation/test validator ต้องปฏิเสธ ห้ามใช้ภาพ test เป็น template เพื่อให้ผ่าน
4. ล็อก config และ split เมื่อทวนครบแล้ว ตั้ง `split_locked=true` ใน provenance จากนั้นสร้าง audit ใหม่พร้อม hash ของ manifest/catalog/provenance ล่าสุด และกรอก run metadata จาก audit ใหม่นี้ เครื่องมือจะปฏิเสธการเสนอ split ใหม่เมื่อ lock แล้ว

Report และ stdout ระบุ `audit_scope=source_manifest` ชัดเจน เมื่อใช้ --propose-splits จะมี `split_proposal.status=unvalidated`, `requires_new_audit=true` และข้อความให้เลือก references ใหม่ `ready_for_evaluation` กับ exit code ของคำสั่งนี้อ้าง **manifest ต้นฉบับ** เท่านั้น แม้เป็น true/0 ก็ไม่ได้รับรอง proposal ที่เพิ่งสร้าง ห้ามนำ audit/hash เดิมไปใช้กับ manifest/catalog ที่เปลี่ยนแล้ว

## ประเมินผล

ใช้ [predictions.csv](templates/predictions.csv) รับผลจริงแยกจาก GT หนึ่งไฟล์ต่อ mode/run และต้องมีครบทุก `(image_id, expected_product)` ใน split ที่เลือก ห้ามเติมผลหายว่า PASS ผล API error ให้ result/reason/timing ว่างแล้วใส่ error_code; storage failure หลังตรวจสำเร็จยังใช้ผลสินค้าจริง ไม่ใช่ operational error ที่ตัดออกจาก metrics

กรอก [run.json](templates/run.json): dataset/config version, commit ที่รันจริง, hardware, resolution และ hash จาก audit ล่าสุด ตั้ง config_locked=true และ locked_at เป็นเวลาที่ล็อกจริง แบบฟอร์มว่างใช้ประเมินไม่ได้ ค่าล็อกเป็นบันทึกของผู้ประเมิน ไม่ใช่หลักฐานทางเทคนิคว่าทีมไม่เคยปรับจาก test

```powershell
.\05_dataset_testing\.venv\Scripts\python.exe -B 05_dataset_testing/evaluate.py --root datasets --manifest datasets/manifests/labels.csv --catalog datasets/config/products.json --provenance datasets/manifests/provenance.json --predictions datasets/manifests/webcam-predictions.csv --run datasets/manifests/run.json --mode webcam --split test --report datasets/manifests/evaluation-v1.json
```

เครื่องมือตรวจ dataset gate ซ้ำและ hash/version ต้องตรง run รับ mode=simulation/webcam; split=development/validation/test หน่วยคือหนึ่ง inspection ที่ผูกกับภาพหลักและ expected product เดียว หากทดสอบการเลือกมุมหลายภาพในฉาก ให้เก็บผล sequence/job และหลักฐานตาม integration checklist แยก ไม่ถือภาพทุกมุมเป็นหนึ่ง inspection เอง

Confusion matrix รวม PASS/FAIL/REVIEW และแยก operational errors ตาม GT ทุก rate มี numerator/denominator: false pass=GT FAIL→PASS / GT FAIL ที่ตรวจสำเร็จ, false reject=GT PASS→FAIL / GT PASS ที่ตรวจสำเร็จ, fail recall=GT FAIL→FAIL / GT FAIL ที่ตรวจสำเร็จ, review rate=predicted REVIEW / valid inspections และ GT PASS ที่คัดออกเพราะ REVIEW แยกอีกตัว ตัวหาร 0 แสดง null (N/A) ไม่แสดง 0% เวลาเป็น millisecond จริงจาก API แยก orientation/inspection/storage/total พร้อม n/median/p95 (linear interpolation) ไม่รวม animation/network/ผู้ใช้หมุนเอง

รายงานแยกสินค้าและ condition ภายใน mode นั้น พร้อมรายการผลผิดและ hash ของ predictions/run เพื่อทำซ้ำ รายงานทั้งจำนวนภาพต้นฉบับและจำนวนกรณีตรวจ เนื่องจากภาพเดิมที่เปลี่ยน expected product ไม่ใช่ตัวอย่างภาพอิสระใหม่

## ขอบเขตที่ต้องรอทีม

ยังต้องยืนยันสินค้า/tolerance/required-view profile, ถ่ายภาพจริงและตรวจทาน, แชร์ข้อมูลอย่างได้รับอนุญาต, ทดสอบกล้อง/ระบบจริงด้วยขวดจริง และวัดผล detector หลังพร้อม Checklist แยกเคส real/hardware ที่ยังไม่ได้ทดสอบออกจาก smoke/browser evidence ที่รันแล้ว ห้ามเปลี่ยนเคสจริงเป็นผ่านจาก unit tests

## เครื่องมือที่เพิ่มสำหรับใบงาน A–E

- `import_predictions.py`: แปลง raw HTTP receipts เป็น predictions CSV; ปฏิเสธ DEMO/mode-config ปน/inspection ซ้ำ และแยก multi-view ที่ยังไม่ได้ตกลง protocol ออกจาก single-view
- `evidence.py`: ตรวจชื่อ case/status/ผู้ทดสอบ/วันเวลา/commit และ hash ไฟล์หลักฐานของเคสที่รันแล้ว
- `compare_screenshots.py`: สร้าง side-by-side และ diff ที่ viewport ตรงกัน พร้อมบันทึก mask ของ timestamp/id/animation ยังต้อง human review ไม่ใช่ auto pass
- `run_checks.py`: รวม dataset/repository/backend/frontend tests และ build พร้อมรายงาน dependency/source hashes และ fail หากไม่มี tests หรือมี skip ดูคำสั่งใน [PROTOCOL.md](PROTOCOL.md)

Workflow ใหม่ `.github/workflows/05-testing.yml` ไม่แก้ workflow กลางเดิมและไม่เปลี่ยน package/lock ของแอป Backend smoke pins อยู่ใน requirements-smoke.txt ของ 05; frontend ใช้ package-lock ของทีมเดิม กล้องจริง/real dataset/visual approval แยกจาก smoke CI

ไม่มีการส่งไฟล์ขึ้น GitHub, เปิด Issue/PR หรือแก้ implementation ของ 01–04 จากเครื่องมือเหล่านี้ เอกสารกติกาที่แนบนอก repo ไม่ถูกคัดลอกเข้า repo
