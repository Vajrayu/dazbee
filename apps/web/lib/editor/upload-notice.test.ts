import { describe, expect, it } from 'vitest'

import { en } from '@/lib/i18n/en.ts'

import { uploadingWords, uploadNotice } from './upload-notice.ts'

const words = en.editor.droppedFiles

describe('uploadingWords', () => {
  it('names one upload, counts more, and says nothing for none', () => {
    expect(uploadingWords(words, ['big.png'])).toBe('Uploading big.png')
    expect(uploadingWords(words, ['big.png', 'Photo · Card'])).toBe('Uploading 2 images')
    expect(uploadingWords(words, [])).toBe('')
  })
})

describe('uploadNotice', () => {
  it('counts a dropped file and an SVG’s pictures in one lasting notice, and keeps saying the file uploads once the pictures are done', () => {
    const left = 'Left out, as only PNG, JPEG, WebP and SVG files go on the design: notes.txt.'
    // A large PNG and an SVG are dropped; the SVG uploads first, then its two pictures.
    expect(uploadNotice(words, { files: ['big.png', 'card.svg'], pictures: [], said: left })).toEqual({
      text: `${left} Uploading 2 images`,
      lasting: true,
    })
    expect(uploadNotice(words, { files: ['big.png'], pictures: ['Photo · card', 'Logo · card'], said: left })).toEqual({
      text: `${left} Uploading 3 images`,
      lasting: true,
    })
    // The pictures are done: the PNG is still uploading, and the notice says so.
    expect(uploadNotice(words, { files: ['big.png'], pictures: [], said: left })).toEqual({
      text: `${left} Uploading big.png`,
      lasting: true,
    })
  })

  it('says what the drop said once nothing uploads, not lasting, and nothing with nothing to say', () => {
    expect(uploadNotice(words, { files: [], pictures: [], said: 'Didn’t upload: big.png (offline).' })).toEqual({
      text: 'Didn’t upload: big.png (offline).',
      lasting: false,
    })
    expect(uploadNotice(words, { files: [], pictures: [], said: '' })).toBeNull()
  })
})
