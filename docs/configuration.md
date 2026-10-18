# Config ร่วมของทีม (แผน implementation)

ไฟล์นี้กำหนดวิธีอ่าน config ที่ต้องสร้างใน M1 ยังไม่มี loader หรือแอปที่รันแล้ว
ใช้ `.env` ที่ repository root เป็นแหล่งร่วมหนึ่งแห่ง; อย่า copy ทับไฟล์ที่มีค่าของเครื่องอยู่แล้ว

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

## Frontend — เจ้าของ 01

Vite อยู่ `apps/web` จึงต้องตั้ง `envDir` ให้ชี้ repository root แบบ absolute
คำนวณจากที่ตั้ง `vite.config.ts` ไม่อิง directory ที่ผู้ใช้เปิด terminal:

```typescript
import { fileURLToPath } from 'node:url'
// ใส่สองค่านี้ใน defineConfig ของแอปเมื่อสร้างแล้ว
const envDir = fileURLToPath(new URL('../../', import.meta.url))
// envDir,
// envPrefix: 'VITE_',
```

คง prefix `VITE_`; browser อ่านเฉพาะ `VITE_API_BASE_URL`
อย่าส่ง `process.env` ทั้งก้อนเข้า client; STORAGE_ROOT และค่าหลังบ้านไม่ใช่ browser config
เมื่อแก้ `.env` ให้ restart dev server; frontend build ใช้ค่าตอน build
อ้างอิง [Vite envDir](https://vite.dev/config/shared-options.html#envdir)
และ [Environment variables](https://vite.dev/guide/env-and-mode.html)

## Backend — เจ้าของ 04

กำหนด `REPO_ROOT` จากตำแหน่ง config module แบบ explicit แล้วอ่าน `REPO_ROOT/.env`
ให้ environment variables ของ process มีลำดับสูงกว่าไฟล์ .env
resolve STORAGE_ROOT / DATASET_ROOT ที่เป็น relative path เทียบ REPO_ROOT เสมอ
การเปิด terminal ที่ root หรือ apps/backend ต้องได้ data directory เดียวกัน
ค่าเป็น absolute path ใช้ตามนั้น; validate เขียนได้ก่อนรับงานตรวจ
กรณีผิดพลาดให้บอก config error ไม่แอบ fallback ไปคนละ directory

| ค่า | หน้าที่/ขอบเขต |
|---|---|
| VITE_API_BASE_URL | URL ที่ browser เรียก API; ไม่มีเครื่องหมาย / ท้ายในค่าเริ่มต้น |
| WEB_ORIGIN | Origin ที่ CORS อนุญาต ตรงกับ URL frontend จริง |
| STORAGE_ROOT / DATASET_ROOT | ที่เก็บภาพผลตรวจ / dataset บนเครื่องที่รัน backend |
| APP_TIMEZONE | วันที่โฟลเดอร์และการแสดงผล; created_at เก็บ UTC |
| MAX_UPLOAD_MB=10 | จำกัด bytes ต่อไฟล์; หน่วย MB ในโปรเจกต์นี้ = 1,000,000 bytes |
| MAX_IMAGE_PIXELS=20000000 | จำกัด width × height ต่อภาพก่อนนำเข้า pipeline |
| MAX_INSPECTION_VIEWS=12 | จำนวนภาพรวม image + supporting_images ต่อ request |
| MAX_REQUEST_MB=40 | จำกัดขนาด HTTP body รวมทุกไฟล์และ multipart overhead |
| MAX_ROTATION_DEG / ROTATION_STEP_DEG | ค่าเริ่มต้นของ simulation; ไม่ใช่หลักฐาน coverage ของภาพ |
| SAVE_ROTATION_FRAMES=false | เก็บ frame ค้นหามุมที่ไม่ได้ใช้ตัดสินเพิ่มเติมหรือไม่ |

ตัวเลขเป็นค่าเริ่มพัฒนา ให้ validate ชนิด/ขอบเขตตอน startup และทดสอบกับ notebook จริง
request เกิน limit ให้ 413; ไฟล์ผิด/field ผิดให้ 400/422 ตาม API contract
ภาพ supporting ที่ใช้ประกอบผลตรวจต้องเก็บเสมอ ไม่ขึ้นกับ SAVE_ROTATION_FRAMES

GET /api/products ส่งค่า rotation ที่อนุญาตใน `simulation_defaults`:
`{max_rotation_deg:360, rotation_step_deg:30}` ให้ 02 ใช้ โดยไม่ส่ง backend paths ออกไป
นี่คือแผน endpoint; เพิ่ม response example และทดสอบจริงพร้อม PR ที่ implement

## Gate ของ config ใน M1

- อ่าน config ได้ทั้งเมื่อรันจาก root และ apps/backend แล้วชี้ storage เดียวกัน
- ค่า VITE_API_BASE_URL ถึง frontend และค่าหลังบ้านไม่ถูกเผยแพร่ใน client bundle
- CORS ตรง origin; ค่า localhost กับ 127.0.0.1 เป็นคนละ origin
- upload limits ใช้จริงทั้งภาพเดี่ยวและหลายภาพ ไม่เชื่อ MIME/นามสกุลอย่างเดียว
- lock dependency รุ่นที่ integration แรกผ่าน; commit package-lock และ lock ฝั่ง Python

ยังไม่ควร pin เวอร์ชันสุ่มเพื่ออ้างว่าทดสอบแล้ว ให้ 01/04 บันทึกรุ่นจากการติดตั้งที่ตรวจผ่านจริง
