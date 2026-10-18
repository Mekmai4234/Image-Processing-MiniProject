# วิธีทำงานร่วมกัน

## Clone ครั้งแรก (PowerShell)

รับคำเชิญ GitHub ก่อนถ้าต้อง push; Public ทำให้ทุกคนอ่านได้ แต่ไม่ได้ให้สิทธิ์เขียน
ถ้าอยู่เครื่องเจ้าของที่มี MiniProject อยู่แล้ว ให้เข้าโฟลเดอร์เดิม ไม่ clone ทับ

```powershell
git clone https://github.com/Mekmai4234/MiniProject.git
cd MiniProject
git switch develop
git pull --ff-only origin develop
```

## เริ่มงานย่อย

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feature/01-upload-panel
```

ตัวอย่างชื่อ: `feature/02-bottle-rotation`, `feature/03-label-matching`,
`feature/04-camera-cleanup`, `test/05-storage-retry`, `docs/05-dataset-guide`
branch ระดับงาน 01–05 เตรียมไว้แล้ว ใช้ได้; งานย่อยใหม่สร้างจาก develop ล่าสุด
หนึ่ง PR ควรแก้โจทย์เดียวและบอกเจ้าของร่วมของไฟล์ที่ชนกัน

## Commit และ Push

```powershell
git status
git diff
py -3 scripts/check_repository.py
git add 01_web_ui/step.txt
git commit -m "docs(01): explain upload workflow"
git push -u origin feature/01-upload-panel
```

ตัวอย่าง git add เป็นเอกสารหนึ่งไฟล์ ให้ระบุไฟล์งานจริงที่จะส่ง ไม่ stage ภาพกล้องทั้งหมด
ข้อความ commit ใช้ `feat(02): ...`, `fix(03): ...`, `test(05): ...`, `docs(04): ...`

## Pull Request

1. บน GitHub เลือก base **develop** และ compare branch งานของตน
2. กรอกแม่แบบ PR: ปัญหา ผลลัพธ์ วิธีทดสอบ ภาพ UI ถ้ามี และ `Closes #หมายเลขงานย่อย`
3. ขอเพื่อนอีกคน review; ผู้เขียนไม่ approve PR ตัวเอง
4. รอ `repository-check` ผ่าน และแก้บทสนทนาค้าง
5. update branch ถ้า develop เปลี่ยน แล้วทดสอบส่วนที่กระทบซ้ำ
6. merge เมื่อครบเกณฑ์ของงาน; การเข้า main ใช้ PR จาก develop สำหรับรอบส่งมอบ

`main` กับ `develop` ตั้งให้ต้องมี PR + approval 1 คน + status check และห้าม force push/delete
ผู้ดูแลยังมี admin bypass สำหรับกู้เหตุขัดข้อง ไม่ใช่ workflow ประจำ
ก่อนมีเพื่อนรับคำเชิญจะยังไม่มีผู้ review ให้ ควรส่ง draft PR และรอสมาชิก

## อัปเดต branch ของตนโดยไม่ rebase ประวัติที่แชร์

```powershell
git fetch origin
git switch feature/01-upload-panel
git merge origin/develop
```

ถ้ามี conflict ให้เปิดแต่ละไฟล์ เลือกเนื้อหาที่ถูกและเอา markers ออก ทดสอบใหม่
แล้ว git add เฉพาะไฟล์ที่แก้และ git commit; ถ้ายังไม่พร้อมใช้ git merge --abort
อย่า force push branch ที่คนอื่นใช้

## สิ่งที่ต้องอัปเดตใน PR

- คู่มือ env/step/process ของงานที่เปลี่ยน และ apps README เมื่อมีคำสั่งรันใหม่
- API contract + ตัวอย่าง + consumers หากเปลี่ยน field
- config_version เมื่อเปลี่ยนเกณฑ์ตรวจ และผล validation ที่สนับสนุน
- implementation-status ให้บอกของจริง ไม่ยก mock เป็นความสามารถที่เสร็จแล้ว
- ไม่ commit .env, venv, node_modules, storage จริง หรือ dataset ที่ยังไม่ตกลงเผยแพร่
- mock ต้องมีป้าย DEMO; ไม่ใส่รหัสผ่านหรือบัญชีตัวอย่างจริงในเอกสาร

## เจ้าของพื้นที่โค้ด

01: app shell/pages/styles/overlay; 02: features/simulation;
03: backend inspection; 04: features/webcam/API/services/db; 05: datasets guide/tests/reports
ใช้ docs/team.md และ Issue assign จริงแทน CODEOWNERS ที่มี username สมมุติ
