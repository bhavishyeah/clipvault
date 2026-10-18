import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImageUpload from './ImageUpload.jsx'

// Regression: Android may back File objects with a lazy content:// grant owned
// by the native input. The input must still own the selected File when the
// upload callback begins; clearing input.value first can invalidate it.
describe('ImageUpload mobile picker lifecycle', () => {
  it('hands the selected File to onImage before resetting the native input', async () => {
    let releaseUpload
    const uploadPending = new Promise((resolve) => { releaseUpload = resolve })
    let input

    const onImage = vi.fn(async (file) => {
      expect(input.files[0]).toBe(file)
      await uploadPending
    })

    const { container } = render(<ImageUpload onImage={onImage} saving={false} />)
    input = container.querySelector('input[type="file"]')
    const file = new File(['mobile-image'], 'photo.jpg', { type: 'image/jpeg' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(onImage).toHaveBeenCalledWith(file)
    expect(input.files[0]).toBe(file)

    releaseUpload()
    await uploadPending
  })
})
