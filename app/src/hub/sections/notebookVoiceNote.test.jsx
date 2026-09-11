/**
 * D-17 — the Notebook's voice note, end to end: dictate -> transcribe -> note.
 *
 * ⛔⛔ WHAT THIS RAIL IS ACTUALLY FOR, AND WHY IT ASSERTS RENDERED TEXT.
 *
 * The transcribe endpoint refuses in four ways a member can act on — 402 "Voice features require a
 * paid plan", 400 "voice features disabled in settings", 429 "monthly dictation cap reached", 503
 * from the provider. A gesture that records someone's voice and then silently discards it is the
 * worst outcome this row could ship, and it is INVISIBLE to a structural assertion: the fan closes
 * either way, the action resolves either way, and `openNote` simply is not called.
 *
 * This hub has already shipped that class of defect twice. One toast passed `message` where the
 * component reads `msg`. One was owned by the element its own action unmounts and rendered for zero
 * frames. Both had green structural coverage. So every feedback case below asserts the SENTENCE IN
 * THE DOCUMENT through `screen.findByText`, never `voiceMsg` state, and it does so against the real
 * `NotebookHubSection` — the component `Layout.jsx` mounts — rather than a harness of its own.
 *
 * ⛔ AND THE EMPTY CONTROL RUNS FIRST. `findByText` on a chip that was never blank would pass with
 * the message hard-coded, so each refusal case asserts the toast is EMPTY before the action fires.
 *
 * MUTATION PROOF (2026-09-10) — each break was made by hand, the named case went RED, and the file
 * was edited back by hand (never `git checkout`):
 *   1. `NotebookHubSection.jsx`: `msg={voiceMsg}` -> `message={voiceMsg}`
 *        => "a refusal is a sentence the member READS" RED: unable to find text.
 *   2. `notebookSection.js`: the catch arm's `setVoiceMsg(...)` -> `/* swallowed *\/`
 *        => both refusal cases RED, while every structural case stayed green — the exact asymmetry
 *           this rail exists for.
 *   3. `voiceNote.js`: `throw new Error(await refusalMessage(res))` -> `return ''`
 *        => "a refusal never writes a note" RED: an empty note was POSTed to /api/j2/notes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { NOTEBOOK_ROUTE } from './notebookSection'
import { modesById } from '../registry'
import { VOICE_NOTE_MESSAGES, TRANSCRIBE_URL, voiceNoteBody, voiceNoteTitle } from '../voiceNote'
import { HubProvider, useHub } from '../HubContext'
import NotebookHubSection from './NotebookHubSection'

const NOTES_URL = '/api/j2/notes'
const ACTION_ID = 'notebook.voiceNote'

// ── the device, as a browser would supply it ──────────────────────────────────────────────────
// Globals, not an injected seam: `voiceNote.js` reads `MediaRecorder` / `navigator.mediaDevices` at
// CALL time exactly the way `VoiceInputButton.jsx:27-31` does, so stubbing the globals exercises the
// real support check instead of a test-only door around it.
function installRecorder() {
  const made = []
  class MockMediaRecorder {
    constructor(stream) {
      this.stream = stream
      this.state = 'inactive'
      this.ondataavailable = null
      this.onstop = null
      made.push(this)
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['FAKE_AUDIO'], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }
  globalThis.MediaRecorder = MockMediaRecorder
  globalThis.navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  }
  return made
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const refuse = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) })

/** Route every call by URL; anything unrouted fails loudly rather than resolving as success. */
function installFetch({ transcribe, notes }) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url) === TRANSCRIBE_URL) return transcribe
    if (String(url) === NOTES_URL) return notes ?? ok({ note: { id: 'n-created' } })
    throw new Error(`unrouted fetch in this rail: ${url}`)
  })
  return calls
}

const capture = { config: null, search: null }

function Probe() {
  const { activeModeConfig } = useHub()
  const loc = useLocation()
  capture.config = activeModeConfig
  capture.search = loc.search
  return null
}

function mount(route = NOTEBOOK_ROUTE) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HubProvider>
        <NotebookHubSection />
        <Probe />
      </HubProvider>
    </MemoryRouter>,
  )
}

/** The action as the member would reach it — re-read every time, because a re-render replaces it. */
const voiceAction = () => (capture.config?.fan || []).find((a) => a.id === ACTION_ID)
const fire = async () => { await act(async () => { await voiceAction().run({}) }) }

/** The one toast chip. Its text is the whole of what the member is told. */
const toastText = () => screen.getByRole('status').textContent

let realFetch
let realMR
let realMedia

beforeEach(() => {
  capture.config = null
  capture.search = null
  realFetch = globalThis.fetch
  realMR = globalThis.MediaRecorder
  realMedia = globalThis.navigator.mediaDevices
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  globalThis.MediaRecorder = realMR
  globalThis.navigator.mediaDevices = realMedia
  vi.restoreAllMocks()
})

describe('D-17 — the action exists and is wired (non-vacuity)', () => {
  it('⛔ the registry declares it on the OUTER ring, with its own icon', () => {
    // Without this every case below could be satisfied by a fan that has no such bubble at all.
    const declared = modesById.notebook.fan.find((a) => a.id === ACTION_ID)
    expect(declared, `${ACTION_ID} is not in the notebook fan — D-17 is not shipped`).toBeTruthy()
    expect(declared.ring, 'the inner ring is already at INNER_MAX and must end with Home').toBe(0)
    expect(declared.kind).toBe('run')
    // ⛔ NOT the same icon as `notebook.voice`, which opens a Compass conversation instead. Two
    // bubbles in one fan that mean different things must not look the same.
    const compass = modesById.notebook.fan.find((a) => a.id === 'notebook.voice')
    expect(compass.icon, 'the fixture changed — this case pins the DISTINCTION, not the value')
      .toBe('mic')
    expect(declared.icon).not.toBe(compass.icon)
  })

  it('⛔ the controller gives it a run body — the registry alone would be a silent bubble', () => {
    installRecorder()
    installFetch({ transcribe: ok({ text: 'hello' }) })
    mount()
    expect(voiceAction(), 'the controller dropped the action').toBeTruthy()
    expect(typeof voiceAction().run, 'no run body: the fan closes and nothing happens — the B2 defect')
      .toBe('function')
  })

  it('off the Notebook route the controller registers nothing to fire', () => {
    installRecorder()
    installFetch({ transcribe: ok({ text: 'hello' }) })
    mount('/dashboard')
    expect((capture.config?.fan || []).find((a) => a.id === ACTION_ID)?.run).toBeUndefined()
  })
})

describe('D-17 — dictate, transcribe, note', () => {
  it('⛔ two fires: the words reach BOTH the transcript call and the note body', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: ok({ text: '  buy the retest  ' }) })
    mount()

    expect(toastText(), 'the chip started with copy in it — every findByText below would be hollow')
      .toBe('')

    await fire()
    // The member is told the mic is live. A recording with nothing on screen saying so is a hot mic.
    expect(toastText()).toMatch(/Recording/i)
    expect(voiceAction().label, 'the bubble reads the same in both states — nothing says which way '
      + 'the next fire goes').toBe('Stop')
    expect(calls.filter((c) => c.url === TRANSCRIBE_URL), 'it uploaded before the member stopped')
      .toHaveLength(0)

    await fire()

    const upload = calls.find((c) => c.url === TRANSCRIBE_URL)
    expect(upload, 'nothing was sent to the transcribe endpoint').toBeTruthy()
    expect(upload.init.method).toBe('POST')
    expect(upload.init.body, 'the audio was not sent as multipart form data').toBeInstanceOf(FormData)
    expect(upload.init.credentials, 'a cookie-authed endpoint called without credentials refuses')
      .toBe('include')

    // ⛔⛔ THE WORDS, IN THE NOTE. A note created without the transcript is the one outcome that
    // looks like success from every other angle: the POST happened, an id came back, the member
    // lands on a note — an EMPTY one, with their words gone.
    const created = calls.find((c) => c.url === NOTES_URL)
    expect(created, 'no note was created').toBeTruthy()
    const body = JSON.parse(created.init.body)
    expect(JSON.stringify(body.bodyJson)).toContain('buy the retest')
    expect(body.bodyJson, 'the body is not the doc shape the server validates')
      .toEqual(voiceNoteBody('buy the retest'))
    expect(body.title, 'an untitled orphan — spec §7 guard (a)').toBeTruthy()
    expect(body.tags).toContain('voice')

    // And it opens what it made, the same way `notebook.newNote` does.
    expect(new URLSearchParams(capture.search).get('note')).toBe('n-created')
  })

  it('the title is the HH:mm shape, and never derived from the transcript', () => {
    const at = new Date(2026, 8, 10, 7, 4)
    expect(voiceNoteTitle(at)).toBe('Voice note · 07:04')
  })
})

describe('⛔⛔ D-17 — a refusal is a sentence the member READS', () => {
  it('the monthly cap: the server\'s own words reach the document', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: refuse(429, 'monthly dictation cap reached') })
    mount()
    expect(toastText(), 'the control: the chip is empty before the refusal').toBe('')

    await fire()
    await fire()

    // ⛔ THE RENDERED TEXT, not `voiceMsg`. A prop-name slip (`message` for `msg`) keeps the state
    // correct and the chip blank, which is how one of this hub's two toast defects shipped.
    expect(await screen.findByText('monthly dictation cap reached')).toBeInTheDocument()
  })

  it('the paid gate: 402 reaches the member instead of vanishing', async () => {
    installRecorder()
    installFetch({ transcribe: refuse(402, 'Voice features require a paid plan') })
    mount()
    expect(toastText()).toBe('')

    await fire()
    await fire()

    expect(await screen.findByText('Voice features require a paid plan')).toBeInTheDocument()
  })

  it('⛔ a refusal never writes a note — no empty note, no navigation', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: refuse(429, 'monthly dictation cap reached') })
    mount()

    await fire()
    await fire()

    expect(calls.filter((c) => c.url === NOTES_URL),
      'a refused transcription still created a note — the member gets a blank note and no words')
      .toHaveLength(0)
    expect(new URLSearchParams(capture.search).get('note'),
      'it navigated to a note that was never created').toBeNull()
  })

  it('a refusal with no readable body still says something', async () => {
    installRecorder()
    installFetch({ transcribe: { ok: false, status: 503, json: async () => { throw new Error('not json') } } })
    mount()

    await fire()
    await fire()

    expect(await screen.findByText(/503/)).toBeInTheDocument()
  })

  it('a browser that cannot record says so — it does not fail open into silence', async () => {
    // No MediaRecorder at all: the support check is the real one in `voiceRecordingSupported`.
    globalThis.MediaRecorder = undefined
    installFetch({ transcribe: ok({ text: 'unused' }) })
    mount()
    expect(toastText()).toBe('')

    await fire()

    expect(await screen.findByText(VOICE_NOTE_MESSAGES.unsupported)).toBeInTheDocument()
  })

  it('a declined microphone says so', async () => {
    installRecorder()
    globalThis.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('NotAllowed'))
    installFetch({ transcribe: ok({ text: 'unused' }) })
    mount()

    await fire()

    expect(await screen.findByText(VOICE_NOTE_MESSAGES.micBlocked)).toBeInTheDocument()
  })

  it('a transcript that comes back blank is a refusal, not an empty note', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: ok({ text: '   ' }) })
    mount()

    await fire()
    await fire()

    expect(await screen.findByText(VOICE_NOTE_MESSAGES.noTranscript)).toBeInTheDocument()
    expect(calls.filter((c) => c.url === NOTES_URL)).toHaveLength(0)
  })
})
