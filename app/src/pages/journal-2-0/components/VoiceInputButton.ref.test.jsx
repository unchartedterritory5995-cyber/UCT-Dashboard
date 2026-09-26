// Wave 7 lane H (H1) — VoiceInputButton's optional ref: `{ start(), available }`.
//
// The Notebook's slash "Dictate" item has no mic of its own to click, so it
// asks the toolbar mic to start through this handle. Two things are railed:
//   1. start() does EXACTLY what a click does — and refuses exactly where a
//      click could not (unpaid, no browser support, disabled, already busy);
//   2. every existing caller is UNCHANGED: none passes a ref, and DayReflection
//      (the Journal's four-section notes) renders and dictates as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import VoiceInputButton from './VoiceInputButton'
import DayReflection from './calendar/DayReflection'
import { AuthContext } from '../../../context/AuthContext'

function installMediaRecorderMock() {
  const instances = []
  class MockMediaRecorder {
    constructor(stream) {
      this.stream = stream
      this.state = 'inactive'
      this.ondataavailable = null
      this.onstop = null
      instances.push(this)
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['FAKE_AUDIO'], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  }
  return instances
}

let saved
beforeEach(() => {
  saved = {
    SR: global.SpeechRecognition, wSR: global.webkitSpeechRecognition, MR: global.MediaRecorder,
    md: global.navigator.mediaDevices, fetch: global.fetch,
  }
  try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch { /* ignore */ }
})
afterEach(() => {
  global.SpeechRecognition = saved.SR
  global.webkitSpeechRecognition = saved.wSR
  global.MediaRecorder = saved.MR
  if (saved.md === undefined) delete global.navigator.mediaDevices
  else global.navigator.mediaDevices = saved.md
  global.fetch = saved.fetch
  vi.restoreAllMocks()
})

const paid = (ui, isPaid = true) => <AuthContext.Provider value={{ isPaid }}>{ui}</AuthContext.Provider>

describe('VoiceInputButton ref — start() is a click, and refuses where a click cannot', () => {
  it('start() begins recording exactly as a click would, and the words reach onTranscript', async () => {
    const recorders = installMediaRecorderMock()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'buy the breakout' }) })
    const onTranscript = vi.fn()
    const ref = createRef()
    render(paid(<VoiceInputButton ref={ref} onTranscript={onTranscript} />))
    expect(ref.current.available).toBe(true)
    let started
    await act(async () => { started = ref.current.start() })
    expect(started).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop voice input' })).toBeInTheDocument())
    // stopping goes through the ordinary button — the same recording
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' })) })
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('buy the breakout'))
    expect(recorders).toHaveLength(1)
  })

  it('an UNPAID member: available is false, start() refuses and records nothing', async () => {
    installMediaRecorderMock()
    const ref = createRef()
    const { container } = render(paid(<VoiceInputButton ref={ref} onTranscript={() => {}} />, false))
    expect(container.innerHTML).toBe('')         // the button renders nothing, as before
    expect(ref.current.available).toBe(false)
    let started
    await act(async () => { started = ref.current.start() })
    expect(started).toBe(false)
    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('a browser that cannot record: available is false and start() refuses', async () => {
    global.SpeechRecognition = undefined
    global.webkitSpeechRecognition = undefined
    global.MediaRecorder = undefined
    const ref = createRef()
    render(paid(<VoiceInputButton ref={ref} onTranscript={() => {}} />))
    expect(ref.current.available).toBe(false)
    expect(ref.current.start()).toBe(false)
  })

  it('a DISABLED mic refuses start(), as its disabled button refuses a click', async () => {
    installMediaRecorderMock()
    const ref = createRef()
    render(paid(<VoiceInputButton ref={ref} onTranscript={() => {}} disabled />))
    expect(ref.current.start()).toBe(false)
    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('start() while already recording refuses — never a second recording', async () => {
    installMediaRecorderMock()
    const ref = createRef()
    render(paid(<VoiceInputButton ref={ref} onTranscript={() => {}} />))
    await act(async () => { ref.current.start() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop voice input' })).toBeInTheDocument())
    expect(ref.current.start()).toBe(false)
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('every existing caller is unchanged', () => {
  it('no caller outside the Notebook editor passes a ref (the handle is additive)', () => {
    const SRC = join(process.cwd(), 'src')
    const files = []
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.jsx?$/.test(n) && !/\.test\./.test(n)) files.push(p)
      }
    }
    walk(SRC)
    const callers = files.filter((f) => /<VoiceInputButton\b/.test(readFileSync(f, 'utf8')))
    // non-vacuity: the known callers are found at all
    const rel = callers.map((f) => relative(SRC, f).replace(/\\/g, '/'))
    expect(rel).toEqual(expect.arrayContaining([
      'pages/journal-2-0/components/calendar/DayReflection.jsx',
      'pages/journal-2-0/components/CompassChat.jsx',
      'pages/journal-2-0/components/notebook/NoteEditorPage.jsx',
    ]))
    for (const f of callers) {
      const r = relative(SRC, f).replace(/\\/g, '/')
      const tags = readFileSync(f, 'utf8').match(/<VoiceInputButton\b[^>]*>/g) || []
      const withRef = tags.filter((t) => /\bref=/.test(t))
      if (r === 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx') expect(withRef).toHaveLength(1)
      else expect(withRef, r).toEqual([])
    }
  })

  it('DayReflection renders its mic and dictates into its section exactly as before', async () => {
    installMediaRecorderMock()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'held the stop' }) })
    render(<DayReflection onSave={vi.fn()} />)   // no AuthProvider: useIsPaid() defaults to true
    fireEvent.click(screen.getByText('Pre-market Prep'))
    const mic = await screen.findByRole('button', { name: 'Start voice input' })
    await act(async () => { fireEvent.click(mic) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop voice input' })).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' })) })
    await waitFor(() => expect(screen.getByDisplayValue('held the stop')).toBeInTheDocument())
  })
})
