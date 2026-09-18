// Feature: sharing-enhancements
//
// Unit tests for uploadFile failure paths (Task 3.3).
//
// Validates: Requirements 1.7, 3.5, 5.7
//
// uploadFile drives an XMLHttpRequest under the hood. These tests replace the
// global XHR with a small controllable fake so we can deterministically drive
// the failure branches: network error, non-2xx response, external-signal
// cancellation, and the 60s timeout abort. In every failure case the returned
// promise must reject and yield NO descriptor, so the caller stores nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadFile } from './uploadFile.js'

// ---------------------------------------------------------------------------
// Controllable fake XMLHttpRequest
// ---------------------------------------------------------------------------
//
// Records event listeners so tests can fire 'load' / 'error' / 'abort' on
// demand, exposes a spy for abort(), and never fires anything on its own.
class FakeXHR {
  constructor() {
    this.listeners = {}
    this.upload = { addEventListener: vi.fn() }
    this.status = 0
    this.responseText = ''
    this.open = vi.fn()
    this.send = vi.fn()
    this.abort = vi.fn()
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler
  }

  // Test helpers to drive the request to a terminal state.
  fire(type) {
    if (this.listeners[type]) this.listeners[type]()
  }

  fireLoad({ status, responseText = '' }) {
    this.status = status
    this.responseText = responseText
    this.fire('load')
  }
}

let instances = []

function installFakeXHR() {
  instances = []
  const ctor = vi.fn(function () {
    const xhr = new FakeXHR()
    instances.push(xhr)
    return xhr
  })
  vi.stubGlobal('XMLHttpRequest', ctor)
}

// The most recently constructed fake XHR.
function lastXHR() {
  return instances[instances.length - 1]
}

// A valid, non-empty image file that clears the pre-upload size gate so the
// request is actually opened and we reach the XHR failure branches.
function makeFile() {
  return { type: 'image/png', size: 1024, name: 'photo.png' }
}

// ---------------------------------------------------------------------------

describe('uploadFile failure paths', () => {
  beforeEach(() => {
    // Ensure the cloudinary config guard passes so we don't early-throw
    // 'Upload not configured'.
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'test-cloud')
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'test-preset')
    installFakeXHR()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('rejects on a network error and returns no descriptor', async () => {
    const promise = uploadFile(makeFile(), { userId: 'u1' })

    // Let the microtask queue run so uploadFile has opened/sent the request
    // and registered its listeners before we fire the error.
    await Promise.resolve()
    lastXHR().fire('error')

    let descriptor
    await expect(
      promise.then((d) => {
        descriptor = d
      }),
    ).rejects.toThrow('Network error')
    expect(descriptor).toBeUndefined()
  })

  it('rejects on a non-2xx status', async () => {
    const promise = uploadFile(makeFile(), { userId: 'u1' })

    await Promise.resolve()
    lastXHR().fireLoad({
      status: 400,
      responseText: JSON.stringify({ error: { message: 'Invalid upload' } }),
    })

    await expect(promise).rejects.toThrow('Invalid upload')
  })

  it('rejects with a default message on a non-2xx status without a JSON body', async () => {
    const promise = uploadFile(makeFile(), { userId: 'u1' })

    await Promise.resolve()
    lastXHR().fireLoad({ status: 500, responseText: '<html>oops</html>' })

    await expect(promise).rejects.toThrow('Upload failed')
  })

  it('rejects with "Upload cancelled" when aborted via AbortSignal and returns no descriptor', async () => {
    const controller = new AbortController()
    const promise = uploadFile(makeFile(), {
      userId: 'u1',
      signal: controller.signal,
    })

    await Promise.resolve()
    // Aborting the controller triggers the xhr.abort() -> 'abort' event path.
    // Our fake's abort() is a spy, so we fire the abort event explicitly to
    // simulate the browser dispatching it after abort().
    controller.abort()
    lastXHR().fire('abort')

    let descriptor
    await expect(
      promise.then((d) => {
        descriptor = d
      }),
    ).rejects.toThrow('Upload cancelled')
    expect(descriptor).toBeUndefined()
    expect(lastXHR().abort).toHaveBeenCalled()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      uploadFile(makeFile(), { userId: 'u1', signal: controller.signal }),
    ).rejects.toThrow('Upload cancelled')
  })

  it('aborts and rejects after the 60s timeout', async () => {
    vi.useFakeTimers()

    const promise = uploadFile(makeFile(), { userId: 'u1' })
    // Attach a rejection handler up-front so the eventual rejection is not
    // reported as unhandled while timers are being advanced.
    const assertion = expect(promise).rejects.toThrow('Upload timed out')

    // Flush the pending microtasks so the XHR is created and the 60s timer is
    // armed, without firing any load/error (the request "never responds").
    await vi.advanceTimersByTimeAsync(0)
    expect(lastXHR().abort).not.toHaveBeenCalled()

    // Advance past the 60s window: the timer fires -> xhr.abort() + reject.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(lastXHR().abort).toHaveBeenCalledTimes(1)
    await assertion

    vi.useRealTimers()
  })
})
