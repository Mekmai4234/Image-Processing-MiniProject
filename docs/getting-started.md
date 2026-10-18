# เริ่มทำงานบนเครื่อง

1. รับคำเชิญ Collaborator แล้ว clone จาก URL ใน README
2. ใช้ `git switch develop` และอ่านเอกสารงานของตน 3 ไฟล์
3. ตรวจโครงสร้างด้วย `py -3 scripts/check_repository.py` (Python stdlib)
4. ทดลองต้นแบบ HTML โดยเปิด `prototypes/conveyor-demo.html` บน browser
5. เลือก Issue งาน 01–05 และกรอกชื่อใน docs/team.md ผ่าน PR
6. สร้าง branch งานจาก develop ล่าสุด

## แยกสิ่งที่รันได้ตอนนี้กับสิ่งที่ต้องสร้าง

ตอนนี้รันได้: ตัวตรวจเอกสาร และต้นแบบ HTML ที่ใช้ภาพจำลอง/อัปโหลดพื้นหลังเรียบ
ยังต้องสร้าง: React app, Three.js scene, FastAPI routes, webcam capture,
ตัวตรวจฉลากจริง และการบันทึกลงเครื่อง

requirements.txt เป็น dependency manifest เริ่มต้นให้ติดตั้งเตรียม Python ได้
เมื่อ app สร้างแล้ว คนที่ 1/4 ต้องเพิ่มคำสั่ง start/build/test ที่ลองรันจริงใน apps README
ห้ามคาดว่า `npm run dev` หรือ `uvicorn app.main:app` รันได้ใน scaffold ปัจจุบัน

## แผนระบบที่ตกลง

- Frontend: React + TypeScript + Vite, เว็บเดียว 3 หน้า
- Simulation: Three.js ภายใน frontend เดียวกัน
- Image processing: Python + OpenCV classical baseline
- Backend: FastAPI + SQLite สำหรับ metadata, ภาพอยู่ filesystem
- Development: frontend localhost:5173 และ backend 127.0.0.1:8000
- Storage: เครื่องที่รัน Backend; ตั้ง STORAGE_ROOT ให้ตรงเครื่องจริง

## รัน Python บน Windows

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/backend/requirements.txt
```

ใช้ 3.12 ได้หากทีมตกลงตรงกัน ไม่ต้องเปลี่ยน PowerShell execution policy
ตั้ง `.env` จาก `.env.example` เฉพาะเครื่องตน หลัง Backend มีตัวอ่าน config แล้ว
ถ้า clone โฟลเดอร์ชื่ออื่น ให้ทำงานจาก repository root ไม่ยึด D: ของเจ้าของ
