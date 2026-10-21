# สถานะตามใบงาน 05-A ถึง 05-E — 22 ตุลาคม 2026

รอบล่าสุดหลัง PR #20 merge: [POSTMERGE-2026-10-22.md](POSTMERGE-2026-10-22.md) ตรวจฐานรวม f487263 ใหม่ ได้ dataset 44/repository 12/frontend 109 และ build ผ่าน แต่ Backend ไม่ผ่าน 3/150 cases จาก UTC/Bangkok date assertions ส่งต่อ 04; browser defects 3 จุดยังพบซ้ำ WebGL ยังไม่ mount และยังไม่ได้ใช้กล้องจริง ไม่เปลี่ยนผลเหล่านี้เป็นผ่าน [acceptance status ล่าสุด](reports/acceptance-status-2026-10-22.json) ยังไม่พร้อมรับงาน ตารางด้านล่างบันทึกขอบเขตเครื่องมือที่มี โดยข้อจำกัดข้อมูลจริง/visual ยังใช้ตามเดิม

เอกสารนี้เป็นสถานะเฉพาะงาน 05 ตามใบงานที่ผู้ใช้ส่ง ไม่แก้ implementation ของ 01–04 และไม่ถือคำสั่งในเอกสารแนบว่าอนุญาตให้ส่งข้อความหาเพื่อนหรือรับรองข้อมูลจริงแทนมนุษย์ เอกสารแนบเก็บอยู่นอก Git ตามเดิม

| ส่วน | ส่วนที่เตรียมและทดสอบได้แล้ว | สิ่งที่ยังต้องใช้ข้อมูล/ทีมจริง |
|---|---|---|
| 05-A Capture | pilot-plan 2 สินค้าชั่วคราว × 3 กลุ่มอิสระ × 6 conditions × 5 ภาพ = แผน 180 ภาพ; manifest/provenance templates | ยังไม่มีภาพจริงใน datasets; ต้องเลือกยี่ห้อ/รุ่น/ขนาด กำหนด tolerance และถ่ายหลายขวดหลาย session/multi-view ที่วัดมุมได้จริง |
| 05-B GT/split | ตรวจ semantics, duplicates/hash/path/leakage/derivatives, misplaced_label และ precedence ตาม pipeline ปัจจุบัน; split ก่อนเลือก references และสร้าง audit ใหม่ | ให้ 03/05 ทวนกฎกับภาพ pilot ผู้ตรวจต้องยืนยันคำตอบ/สิทธิ์/profile เอง ห้ามรับรอง missing_label โดยไม่ validate |
| 05-C Evaluation | แยก single-view receipts จาก GT, ตรวจ DEMO/mode/config/UUID/timing และ evidence, สูตร metrics พร้อมตัวหาร/N/A/mismatches | ยังไม่มีผล accuracy จริง; ต้องตกลง multi-view job protocol, เก็บ predictions จริง, กำหนดเป้าหมายก่อนเปิด final test และล็อก dataset/config |
| 05-D Functional/visual | checklist พร้อมวันที่/commit/tester/hash แยก synthetic/browser/real/hardware/visual; DEMO screenshots และ defect records ของฐานที่ตรวจ; เครื่องมือ side-by-side/diff | PNG ต้นแบบตาม path references ข้างเอกสารแนบยังไม่พบ; ไม่มี visual approval หรือกล้องจริง ต้องให้เจ้าของส่วนแก้ defects แล้วทดสอบซ้ำ |
| 05-E CI/reproducibility | workflow ของ 05 แยก dataset Python matrix, backend/detector/HTTP smoke และ frontend tests/build; pins/lock และ fail เมื่อไม่มี tests/มี skips | ผู้ดูแลต้อง review workflow/ตั้ง required checks เอง; CI synthetic ไม่ทดแทนภาพจริง กล้อง หรือการตรวจหน้าตา |

## Gate ตรวจหลักฐาน

[acceptance-status-2026-10-21.json](reports/acceptance-status-2026-10-21.json) สร้างจาก checklist ปัจจุบัน `records_consistent=true` หมายถึง metadata/hash ของผลที่ระบุว่าทดสอบแล้วตรวจได้ ไม่ใช่ยืนยันว่าทุกกรณีผ่าน `ready_for_acceptance=false` เพราะยังมี failed/not_tested/blocked และขาด passed evidence ชนิด real/hardware/visual

```powershell
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/evidence.py --checklist 05_dataset_testing/integration-checklist.csv --summary path/to/new-status.json
.\05_dataset_testing\.venv\qa311\Scripts\python.exe -B 05_dataset_testing/evidence.py --checklist 05_dataset_testing/integration-checklist.csv --require-complete
```

คำสั่งแรกตรวจความสอดคล้องของ records และใช้ code=0 ได้แม้ระบบยังไม่ตรวจรับ คำสั่งที่สองใช้ code=1 ตามจริงเมื่อยังไม่ครบ ห้ามลดข้อกำหนดหรือเปลี่ยน checklist เป็น passed เพื่อให้คำสั่งผ่าน แม้ครบทั้งชนิดข้อมูลและสถานะแล้ว ยังต้องให้เจ้าของโครงการทวนความแท้/ความพอของหลักฐานก่อนรับงาน

## สิ่งที่แก้เพิ่มในรอบนี้

- Receipt single_view ต้องไม่มี supporting images/angles และ verified_coverage=false ไม่ยอมให้ข้อมูล multi-view ที่ขัดกันเข้า metrics single-view
- Reject evidence/timing ที่เป็น null/array/string ด้วย error ที่ชัดเจน
- Actual screenshot กับ reference ต้องเป็นคนละไฟล์; ไม่ใช้ไฟล์เดียวเทียบตัวเองแล้วอ้างว่าตรงต้นแบบ สำเนาที่เป็นคนละไฟล์ยังต้องตรวจที่มาโดยมนุษย์ ไม่อ้างว่าเครื่องมือตรวจ provenance ของ reference ได้เอง
- เพิ่ม acceptance summary และ strict gate พร้อม tests แยก synthetic pass ออกจากการรับงาน real/hardware/visual

ไฟล์จากคำขอเตรียมภาพส่ง 02 ที่ผู้ใช้ยกเลิกถูกแยกเก็บใน local ignored folder ไม่รวมใน commit/PR รอบนี้ ไม่มีการสร้างภาพ AI/ข้อมูล GT/ผล accuracy หรือภาพเทียบต้นแบบทดแทนไฟล์ที่ยังไม่มี
