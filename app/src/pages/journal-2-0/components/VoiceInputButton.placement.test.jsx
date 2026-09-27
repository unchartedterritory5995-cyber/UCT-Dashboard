// Wave 10 follow-up F1 -- where the voice first-run hint sits.
//
// ⛔ A STRUCTURAL RAIL, NOT THE VERDICT. jsdom lays nothing out, so it cannot see
// the hint run past a 390 px viewport; the verdict is the real-browser walk row
// B9d (tools/notebook_wave10b_walk.py), which measures the document and the app's
// <main> scroller at 390 and 820 px with the hint shown and dismissed. Measured
// there before this fix: the Notebook toolbar mic sits at x 263 on a 390 px phone,
// the 230 px hint started at the mic's left edge and ran to x 493, and <main> grew
// to 496 px.
//
// What jsdom CAN prove, and this file does: the placement arithmetic (placeHint),
// that the component APPLIES it once layout exists (faked in below, then undone),
// that it re-places on a resize, that with no layout it keeps the authored anchor
// (the four existing hint tests see exactly what they saw before), and the width
// cap on the rendered hint.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import VoiceInputButton from './VoiceInputButton'
import { placeHint, HINT_GUTTER } from './voiceHintPlacement'

const HINT_KEY = 'voice.dictation.hintSeen'

describe('placeHint -- the hint inside the viewport', () => {
  it('slides a hint that would run off the right edge back to the gutter (the 390 px Notebook mic)', () => {
    const x = placeHint({ anchorLeft: 263, hintWidth: 230, viewportWidth: 390 })
    expect(263 + x + 230).toBe(390 - HINT_GUTTER)
    expect(x).toBe(-119)
  })

  it('leaves a hint that fits exactly where it was authored -- at the mic', () => {
    expect(placeHint({ anchorLeft: 40, hintWidth: 230, viewportWidth: 820 })).toBe(0)
  })

  it('never starts left of the gutter (a mic hard against the left edge)', () => {
    expect(placeHint({ anchorLeft: 4, hintWidth: 230, viewportWidth: 390 })).toBe(HINT_GUTTER - 4)
  })

  it('a hint as wide as the viewport less both gutters sits exactly between them', () => {
    const w = 390 - 2 * HINT_GUTTER
    const x = placeHint({ anchorLeft: 200, hintWidth: w, viewportWidth: 390 })
    expect(200 + x).toBe(HINT_GUTTER)
    expect(200 + x + w).toBe(390 - HINT_GUTTER)
  })
})

function installMediaRecorderMock() {
  class MockMediaRecorder {
    constructor() { this.state = 'inactive' }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = { getUserMedia: vi.fn() }
}

describe('VoiceInputButton applies the placement', () => {
  let originalMR
  let originalNav
  const undo = []

  beforeEach(() => {
    originalMR = global.MediaRecorder
    originalNav = global.navigator.mediaDevices
    localStorage.removeItem(HINT_KEY)
    installMediaRecorderMock()
  })

  afterEach(() => {
    while (undo.length) undo.pop()()
    global.MediaRecorder = originalMR
    if (originalNav === undefined) delete global.navigator.mediaDevices
    else global.navigator.mediaDevices = originalNav
    localStorage.removeItem(HINT_KEY)
    vi.restoreAllMocks()
  })

  /** Fake the three layout reads the component makes: the hint's width, the mic
   *  wrapper's left edge (the one element that CONTAINS the hint), the viewport. */
  function fakeLayout({ micLeft, hintWidth, viewport }) {
    const box = { left: micLeft }
    const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() { return this.getAttribute('role') === 'status' ? hintWidth : 0 },
    })
    undo.push(() => Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow))
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      const left = this.querySelector && this.querySelector(':scope > [role="status"]') ? box.left : 0
      return { left, right: left, top: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() {} }
    })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport })
    undo.push(() => { delete document.documentElement.clientWidth })
    return box
  }

  it('places the hint so it ends at the gutter when the mic sits right of centre', () => {
    fakeLayout({ micLeft: 263, hintWidth: 230, viewport: 390 })
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByRole('status').style.left).toBe('-119px')
  })

  it('re-places it on a resize (the mic moved)', () => {
    const box = fakeLayout({ micLeft: 263, hintWidth: 230, viewport: 390 })
    render(<VoiceInputButton onTranscript={() => {}} />)
    box.left = 40
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(screen.getByRole('status').style.left).toBe('0px')
  })

  it('with no layout (a test DOM) keeps the authored anchor at the mic', () => {
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByRole('status').style.left).toBe('0px')
  })

  it('caps the hint at the viewport less both gutters, whatever its authored width', () => {
    render(<VoiceInputButton onTranscript={() => {}} />)
    const hint = screen.getByRole('status')
    expect(hint.getAttribute('style')).toMatch(
      new RegExp(`max-width:\\s*calc\\(100vw - ${2 * HINT_GUTTER}px\\)`),
    )
  })

  it('⭐ CONTROL -- the hint is one-time exactly as before: dismissed, it does not render', () => {
    localStorage.setItem(HINT_KEY, '1')
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
