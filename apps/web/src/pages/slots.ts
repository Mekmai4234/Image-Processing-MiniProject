// ร่างข้อตกลง props/events สำหรับคอมโพเนนต์ที่ 04 จะส่งมาฝัง
// ฉาก Simulation ของ 02 ใช้ type จริงใน features/simulation แล้ว (SimulationSceneProps) จึงลบร่างเดิมออก
// ยังเป็นร่างเพื่อคุยกัน — แก้ได้เมื่อ 04 ยืนยัน แล้วย้าย type ไป features/webcam

/** 04: features/webcam ส่ง <CameraPanel {...props} /> ให้ WebcamPage และรับผิดชอบปิด media tracks */
export interface CameraPanelProps {
  /** false = ต้องหยุดกล้องทันที */
  active: boolean
  /** preview กลับซ้ายขวาหรือไม่ เพื่อให้ overlay mirror ตาม */
  mirrored: boolean
  onStatusChange(status: 'idle' | 'requesting' | 'streaming' | 'denied' | 'error', message?: string): void
  /** frame สำหรับ locator (throttle และมีคำขอค้างได้ครั้งเดียว) */
  onFrame?(frame: Blob): void
}

export interface CameraPanelHandle {
  /** ถ่ายภาพเต็มความละเอียด ไม่ mirror */
  capture(): Promise<Blob>
  stop(): void
}
