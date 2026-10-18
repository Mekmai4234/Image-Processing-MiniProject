# Frontend workspace — planned

สถานะ: ยังไม่มี React app/package.json คำสั่ง npm ci/dev/build ยังใช้ไม่ได้
01 เป็นเจ้าของ app shell, 02 เพิ่ม simulation, 04 เพิ่ม webcam
ใช้ React + TypeScript + Vite; Three.js สำหรับฉากจำลอง
สร้าง app ภายในโฟลเดอร์นี้โดยรักษา README และเพิ่ม package-lock.json

```text
src/pages/                 SimulationPage, WebcamPage, HistoryPage (01)
src/components/            shared overlay/results (01)
src/features/simulation/   Three.js scene/state (02)
src/features/webcam/       CameraPanel/capture/cleanup (04)
src/lib/api.ts             API client (01/04)
src/types/inspection.ts    shared contract (01/03/04)
```

PR app shell ต้องเพิ่มคำสั่ง install/start/build/test ที่รันทดสอบแล้ว
และระบุ port + VITE_API_BASE_URL; ปุ่ม mock ต้องบอก DEMO

## Config และไฟล์ร่วม

ตั้ง envDir เป็น repository root ด้วย absolute path ที่คำนวณจากตำแหน่ง vite.config.ts
คง envPrefix เป็น VITE_; ดู [configuration](../../docs/configuration.md)
01 รับผิดชอบ package.json/package-lock.json, Vite config และ shared API client
02/04 ขอเพิ่ม dependency ผ่าน PR ประสาน 01 และ commit lockfile ที่ตรงกัน
เริ่มสร้างในโฟลเดอร์นี้อย่างระวัง README เดิม; อย่าใช้คำสั่งสร้างแอปที่ลบไฟล์เดิมทั้งหมด
