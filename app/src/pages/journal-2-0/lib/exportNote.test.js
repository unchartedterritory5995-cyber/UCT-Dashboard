// Wave 10 TY3: `exportNoteAsPng` now scopes a `uct-exporting-note` body class
// around the real `domToBlob` capture, the same shape `printNote()` already
// uses for `uct-print-note` -- the CSS it drives (NoteEditorPage.module.css,
// `:global(body.uct-exporting-note) .proseEditor > *`) forces every
// content-visibility:auto block back to `visible` for the span of the
// capture (verified in a real browser: docs/notebook/perf-runs/ty3/
// README.md, checks #8a/#8b). This file proves the CLASS LIFECYCLE itself:
// present during the capture, gone afterward, on both the success and the
// failure path -- the one thing jsdom (no layout, no content-visibility)
// can actually verify about this change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const domToBlob = vi.fn()
vi.mock('modern-screenshot', () => ({ domToBlob: (...args) => domToBlob(...args) }))

// Imported AFTER the mock is registered (hoisted by vitest regardless, but
// kept in this order for readability).
import { exportNoteAsPng } from './exportNote'

const EXPORTING_CLASS = 'uct-exporting-note'

beforeEach(() => {
  domToBlob.mockReset()
  document.body.className = ''
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = realCreate(tag, ...rest)
    if (tag === 'a') el.click = () => {}
    return el
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('exportNoteAsPng -- the uct-exporting-note class lifecycle', () => {
  it('adds the class before calling domToBlob, and it is gone by the time the call returns', async () => {
    let classDuringCapture = null
    domToBlob.mockImplementation(async () => {
      classDuringCapture = document.body.classList.contains(EXPORTING_CLASS)
      return new Blob(['x'], { type: 'image/png' })
    })
    const el = document.createElement('div')
    const ok = await exportNoteAsPng(el, 'My note')
    expect(ok).toBe(true)
    expect(classDuringCapture).toBe(true)
    expect(document.body.classList.contains(EXPORTING_CLASS)).toBe(false)
  })

  it('still removes the class when domToBlob throws -- the try/finally, not just the happy path', async () => {
    domToBlob.mockImplementation(async () => { throw new Error('capture failed') })
    const el = document.createElement('div')
    await expect(exportNoteAsPng(el, 'My note')).rejects.toThrow('capture failed')
    expect(document.body.classList.contains(EXPORTING_CLASS)).toBe(false)
  })

  it('never adds the class at all when there is no element to capture', async () => {
    const ok = await exportNoteAsPng(null, 'My note')
    expect(ok).toBe(false)
    expect(domToBlob).not.toHaveBeenCalled()
    expect(document.body.classList.contains(EXPORTING_CLASS)).toBe(false)
  })

  it('leaves any OTHER body class untouched', async () => {
    document.body.classList.add('some-other-class')
    domToBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const el = document.createElement('div')
    await exportNoteAsPng(el, 'My note')
    expect(document.body.classList.contains('some-other-class')).toBe(true)
  })
})
