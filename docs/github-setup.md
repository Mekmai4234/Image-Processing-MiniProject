# GitHub และการเชิญเพื่อน

Repository เป้าหมาย: https://github.com/Mekmai4234/MiniProject (Public)
Public = อ่านได้ทั่วไป; สิทธิ์ push ต้องรับคำเชิญ Collaborator

## เจ้าของเชิญสมาชิก

1. ไปที่ Settings → Collaborators → Add people
2. ใส่ GitHub username ที่สมาชิกแจ้งและเลือกบัญชีให้ถูก
3. ส่งคำเชิญ สมาชิกกด Accept แล้ว clone ตาม CONTRIBUTING.md
4. กรอก docs/team.md และ assign Issue หลัก 01–05 ให้ผู้รับผิดชอบ

ยังไม่มี username สมาชิก จึงไม่ส่งคำเชิญหรือใส่ assignee สมมุติ
Collaborator ได้สิทธิ์ repo ไม่ใช่เฉพาะโฟลเดอร์ 01–05; ใช้ข้อตกลงทีมและ PR review แบ่งงาน
ข้อมูลจริงใน storage/datasets ไม่ถูกส่งไป GitHub ด้วย git push

## ตั้งระบบงาน

main เป็น default branch, develop เป็นที่รวมงาน
เตรียม feature branch 01–05 จาก baseline; งานย่อยใหม่ให้เริ่ม develop ล่าสุด
มี 5 Issue หลัก, area labels, 4 milestone, แม่แบบ task/bug และ PR
main/develop ต้องมี PR, approval 1 คน, repository-check ผ่าน และ resolve conversations
ห้าม force push/delete บนสอง branch นี้; admin bypass มีเพื่อเหตุจำเป็นเท่านั้น
CI baseline เป็น repository structure check เพิ่ม build/tests เมื่อแอปมีจริง

## แหล่งอ้างอิง

- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository
- https://docs.github.com/en/rest/branches/branch-protection
