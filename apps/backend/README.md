# Backend workspace — planned

สถานะ: ยังไม่มี FastAPI app หรือ endpoints; requirements.txt ใช้เตรียม venv ได้
03 ทำ app/inspection; 04 ทำ API/services/db และเชื่อม storage; 05 ช่วย tests

```text
app/main.py
app/api/
app/inspection/
app/services/
app/db/
tests/inspection/
tests/api/
tests/storage/
```

คนที่ 4 ต้องเพิ่มคำสั่ง uvicorn และอ่าน .env จริงหลังสร้าง app
คนที่ 3 ส่ง pure functions ไม่ต้องผูก HTTP; storage root ตั้งตามเครื่องจริง
บันทึกรุ่น dependency ที่ติดตั้งและ lock หลัง integration แรกผ่าน

## Config และขอบเขตการเชื่อม

04 รับผิดชอบ config loader, requirements/lock และ HTTP schema;
03 ดูแล pure inspection functions; 05 ช่วย tests กับภาพตัวอย่างที่อนุญาต
อ่าน .env จาก repository root และ anchor path ตาม [configuration](../../docs/configuration.md)
input หลายมุมและผลบันทึกต้องตรง contract v0.2 รวมการบันทึกหลักฐาน supporting images
