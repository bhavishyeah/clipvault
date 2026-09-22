// VOLT — Shared Upload_Service
// Generalizes the inline XHR-with-progress Cloudinary upload from
// useClips.saveImage into a reusable function used by clip storage,
// direct send, and group sends. Enforces the size gate before opening
// the request, always POSTs to the Cloudinary `auto` endpoint so it detects
// the resource type per file (the unsigned preset is image-oriented; a
// specific per-kind endpoint causes Cloudinary to reject non-image POSTs),
// reports progress, supports cancellation, and aborts after 60s.

import { classifyFile, resourceTypeFor, validateFile, SIZE_LIMITS } from './fileType'

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

// Abort the request if Cloudinary does not respond within this window (Req 3.5).
const UPLOAD_TIMEOUT_MS = 60_000

/**
 * Thrown when a file fails the pre-upload size gate. Callers can distinguish
 * this from network/upload failures to show the right message (Req 1.6, 2.1, 2.2).
 */
export class SizeError extends Error {
  /**
   * @param {string} message
   * @param {{ reason?: 'empty' | 'too_large', limit?: number }} [details]
   */
  constructor(message, { reason, limit } = {}) {
    super(message)
    this.name = 'SizeError'
    this.reason = reason
    this.limit = limit
  }
}

/**
 * @typedef {Object} UploadDescriptor
 * @property {string} secure_url - Cloudinary HTTPS URL
 * @property {'image' | 'video' | 'auto'} resource_type - endpoint used
 * @property {number} bytes - size reported by Cloudinary
 * @property {string} format - file format reported by Cloudinary
 * @property {string} mime - original file.type
 * @property {string} name - original file.name
 */

/**
 * Upload a file to Cloudinary and normalize the response.
 *
 * Enforces the size gate BEFORE opening the request (throws SizeError on an
 * oversize/empty file — Req 1.6, 2.x), always POSTs to the `auto` endpoint so
 * Cloudinary detects the resource type per file (Req 3.1–3.2), always includes
 * the unsigned preset and the per-user folder (Req 3.3), and aborts after 60s
 * (Req 3.5).
 *
 * @param {File | Blob & { name?: string, type?: string }} file
 * @param {Object} options
 * @param {string} options.userId - used for the `volt/{userId}` folder path
 * @param {(pct: number) => void} [options.onProgress] - upload progress 0-100
 * @param {AbortSignal} [options.signal] - optional external cancellation
 * @returns {Promise<UploadDescriptor>}
 */
export async function uploadFile(file, { userId, onProgress, signal } = {}) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Upload not configured')
  }

  // Size gate BEFORE opening the request (Req 1.6, 2.1, 2.2).
  const check = validateFile({ type: file.type, size: file.size })
  if (!check.ok) {
    const message =
      check.reason === 'too_large'
        ? `File exceeds the ${check.limit === SIZE_LIMITS.audio ? '10' : '15'} MB limit`
        : 'File is empty'
    throw new SizeError(message, { reason: check.reason, limit: check.limit })
  }

  const kind = classifyFile(file.type)

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
  formData.append('folder', `volt/${userId}`)

  const uploaded = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    // Abort after 60s (Req 3.5).
    const timer = setTimeout(() => {
      xhr.abort()
      reject(new Error('Upload timed out'))
    }, UPLOAD_TIMEOUT_MS)

    // Honor an external AbortSignal for user-initiated cancellation.
    const onAbort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error('Upload cancelled'))
        return
      }
      signal.addEventListener('abort', onAbort)
    }

    const cleanup = () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Malformed upload response'))
        }
      } else {
        let message = 'Upload failed'
        try {
          message = JSON.parse(xhr.responseText).error?.message || message
        } catch {
          // Keep the default message when the error body is not JSON.
        }
        reject(new Error(message))
      }
    })

    xhr.addEventListener('error', () => {
      cleanup()
      reject(new Error('Network error'))
    })
    xhr.addEventListener('abort', () => {
      cleanup()
      reject(new Error('Upload cancelled'))
    })

    // Always POST to the `auto` endpoint so Cloudinary detects the resource
    // type per file — mixing a specific per-kind endpoint with the
    // image-oriented unsigned preset causes non-image POSTs to be rejected.
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`)
    xhr.send(formData)
  })

  // Normalize the Cloudinary response into an UploadDescriptor (Req 3.4, 1.5, 5.3).
  // Prefer the resource_type Cloudinary actually stored; fall back to the
  // MIME-derived guess if the response omits it.
  return {
    secure_url: uploaded.secure_url,
    resource_type: uploaded.resource_type ?? resourceTypeFor(kind),
    bytes: uploaded.bytes,
    format: uploaded.format,
    mime: file.type,
    name: file.name,
  }
}
