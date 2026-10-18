# Synthetic contract examples

JSON/CSV เป็นข้อมูลตัวอย่างที่เขียนขึ้นเพื่อพัฒนา interface เท่านั้น
ไม่มีภาพหรือผลทดลองจริง; id และ URL เป็น illustrative ยังเรียกไม่ได้
match score ตัวเลขสมมุติ; wrong-label score สูงยัง FAIL ได้
examples/products.example.json ยังไม่มี brand/size/templates จริง
ใช้รูปแบบนี้สร้างไฟล์ catalog ท้องถิ่นหลังทีมเลือกขวดและกำหนด tolerance

InspectionResult ใช้ UUID รูปแบบจริงเพื่อพัฒนา schema แต่ demo=true และ URL ยังเป็นตัวอย่าง
score_method ระบุการ clamp เพื่อไม่สับสนกับค่าดิบ OpenCV; evidence แสดงทั้งภาพเดี่ยวและหลายมุมที่ยังไม่ยืนยัน coverage
labels.csv แยก product_id (ตัวขวด) / label_product (ฉลากที่รู้) / expected_product (สินค้าที่คาด)
split_group_id เป็นกลุ่มเชื่อมโยงขวด/session; ตัวอย่าง 3 แถวไม่ใช่ dataset สำหรับวัด accuracy

[ตัวอย่างหามุมไม่สำเร็จ](inspection-orientation-review.json) มี reported coverage 360 แต่ยัง REVIEW
เพราะ verified_coverage=false และไม่มี validated profile; จำนวนมุมเพียงอย่างเดียวไม่พิสูจน์ว่าฉลากหาย
