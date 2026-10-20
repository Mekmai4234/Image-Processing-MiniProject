import { useEffect, useRef } from 'react'

/** สร้าง object URL จากไฟล์ และ revoke ทั้งหมดเมื่อออกจากหน้า */
export function useObjectUrls() {
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const set = urls.current
    return () => {
      set.forEach((u) => URL.revokeObjectURL(u))
      set.clear()
    }
  }, [])
  return {
    create(blob: Blob) {
      const u = URL.createObjectURL(blob)
      urls.current.add(u)
      return u
    },
    revoke(u: string) {
      URL.revokeObjectURL(u)
      urls.current.delete(u)
    },
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}
