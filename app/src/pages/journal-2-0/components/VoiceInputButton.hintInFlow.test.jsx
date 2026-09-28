// Wave 10 follow-up F5 -- the voice first-run hint in the Notebook takes its own place.
//
// proof walk 10E-1 6b (docs/notebook/proof/walk-fd7d1f42d/geometry.json.gz, surface
// nb-note-first-run): hanging ABOVE the mic, the hint covered "Add a tag to this note"
// at 1200 px and the editor's formatting row (Font family, Text size, B, the lists,
// quote, code, Insert link) at 820 and 390 px. F1's placeHint fixed where it sits
// SIDEWAYS; nothing it can do sideways stops a box that hangs over the line above.
//
// With `hintInFlow` the hint is a flex item AFTER the mic in the editor's wrapping
// toolbar row: the row makes room for it, so it covers nothing. jsdom lays nothing
// out, so this rails the structure; the geometry is the proof walk's before/after
// (docs/notebook/proof/f5-*/).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import VoiceInputButton from './VoiceInputButton'

const HINT_KEY = 'voice.dictation.hintSeen'

function installMediaRecorderMock() {
  class MockMediaRecorder {
    constructor() { this.state = 'inactive' }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = { getUserMedia: vi.fn() }
}

let originalMR
let originalNav
beforeEach(() => {
  originalMR = global.MediaRecorder
  originalNav = global.navigator.mediaDevices
  localStorage.removeItem(HINT_KEY)
  installMediaRecorderMock()
})
afterEach(() => {
  global.MediaRecorder = originalMR
  if (originalNav === undefined) delete global.navigator.mediaDevices
  else global.navigator.mediaDevices = originalNav
  localStorage.removeItem(HINT_KEY)
  vi.restoreAllMocks()
})

const hint = () => screen.getByRole('status')
const mic = () => screen.getByRole('button', { name: 'Start voice input' })

describe('VoiceInputButton hintInFlow -- the hint takes its own place', () => {
  it('renders AFTER the mic, as a box of the row -- no absolute placement, no offsets', () => {
    render(<VoiceInputButton onTranscript={() => {}} hintInFlow />)
    const h = hint()
    expect(h).toHaveTextContent(/speak instead of type/i)
    expect(h.getAttribute('data-hint-placement')).toBe('in-flow')
    expect(mic().compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING, 'after the mic').toBeTruthy()
    expect(['absolute', 'fixed']).not.toContain(h.style.position)
    expect(h.style.bottom).toBe('')
    expect(h.style.left).toBe('')
    expect(h.style.maxWidth, 'never wider than the row').toBe('100%')
  })

  it('the wrapper wraps, so the mic and its hint share the row without widening it', () => {
    render(<VoiceInputButton onTranscript={() => {}} hintInFlow />)
    const wrap = mic().parentElement
    expect(wrap.contains(hint())).toBe(true)
    expect(wrap.style.flexWrap).toBe('wrap')
    expect(wrap.style.maxWidth).toBe('100%')
  })

  it('its dismiss is a box of the hint too -- nothing hangs outside it', () => {
    render(<VoiceInputButton onTranscript={() => {}} hintInFlow />)
    const x = screen.getByRole('button', { name: 'Dismiss tip' })
    expect(hint().contains(x)).toBe(true)
    expect(['absolute', 'fixed']).not.toContain(x.style.position)
    fireEvent.click(x)
    expect(screen.queryByRole('status')).toBeNull()
    expect(localStorage.getItem(HINT_KEY)).toBe('1')
  })

  it('in flow, a measured layout is NOT applied as an offset (it would shove a relative box sideways)', () => {
    const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() { return this.getAttribute('role') === 'status' ? 230 : 0 },
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => (
      { left: 263, right: 263, top: 0, bottom: 0, width: 0, height: 0, x: 263, y: 0, toJSON() {} }))
    try {
      render(<VoiceInputButton onTranscript={() => {}} hintInFlow />)
      expect(hint().style.left).toBe('')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow)
    }
  })

  it('control: without the prop the hint still floats above the mic (the other four callers)', () => {
    render(<VoiceInputButton onTranscript={() => {}} />)
    const h = hint()
    expect(h.style.position).toBe('absolute')
    expect(h.style.bottom).toBe('calc(100% + 8px)')
    expect(h.getAttribute('data-hint-placement')).toBeNull()
    expect(h.compareDocumentPosition(mic()) & Node.DOCUMENT_POSITION_FOLLOWING, 'the float precedes the mic').toBeTruthy()
  })
})

describe('the Notebook editor opts in', () => {
  // A structural read of the ONE place the Notebook renders a mic. It names the line
  // it guards, so a failure says where to look.
  const FILE = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'NoteEditorPage.jsx')
  const src = readFileSync(FILE, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))
  const tags = [...code.matchAll(/<VoiceInputButton\b[^>]*>/g)]

  it('non-vacuity: NoteEditorPage renders exactly one VoiceInputButton', () => {
    expect(tags.length).toBe(1)
  })

  it('and that one passes hintInFlow', () => {
    const [m] = tags
    const line = code.slice(0, m.index).split('\n').length
    expect(/\shintInFlow(\s|\/|>|=\{true\})/.test(m[0]), `NoteEditorPage.jsx:${line} -- ${m[0]}`).toBe(true)
  })
})
