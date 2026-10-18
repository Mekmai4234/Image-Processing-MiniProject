import type { CaptureFrameResult } from './types'

/**
 * Generate standard UUID v4 for client_request_id
 */
export function generateClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Capture video element frame at exact native resolution (Rule 6.2: Not CSS size)
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  mimeType: string = 'image/jpeg',
  quality: number = 0.92
): Promise<CaptureFrameResult> {
  const width = video.videoWidth
  const height = video.videoHeight

  if (!width || !height) {
    throw new Error('Video stream is not ready or has zero dimensions.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create 2D canvas rendering context.')
  }

  // Draw unmirrored frame to ensure true optical orientation matches backend expectation
  ctx.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to export canvas to Blob'))
      },
      mimeType,
      quality
    )
  })

  return {
    blob,
    width,
    height,
    timestamp: Date.now(),
  }
}

/**
 * Capture a downscaled frame optimized for fast, low-latency throttled locator calls
 */
export async function captureThumbnail(
  video: HTMLVideoElement,
  maxDimension: number = 480,
  quality: number = 0.8
): Promise<Blob> {
  const srcWidth = video.videoWidth
  const srcHeight = video.videoHeight

  if (!srcWidth || !srcHeight) {
    throw new Error('Video stream is not ready or has zero dimensions.')
  }

  let targetWidth = srcWidth
  let targetHeight = srcHeight

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((srcHeight * maxDimension) / srcWidth)
      targetWidth = maxDimension
    } else {
      targetWidth = Math.round((srcWidth * maxDimension) / srcHeight)
      targetHeight = maxDimension
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create 2D canvas rendering context.')
  }

  ctx.drawImage(video, 0, 0, targetWidth, targetHeight)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to export thumbnail canvas to Blob'))
      },
      'image/jpeg',
      quality
    )
  })
}
